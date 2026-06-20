use anyhow::Result;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;

use crate::{
    config::Settings,
    services::{
        scanner::parse_video_filename,
        tvmaze::{self, TvMazeService},
        wikidata::{WikidataService, WikidataShowResult},
    },
};

fn build_http_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Kubuno/0.1 (self-hosted media server)")
        .build()?)
}

/// Normalize a title for fuzzy-but-safe comparison: lowercase, strip accents and
/// any non-alphanumeric character, collapse spaces. "Hunger (film, 2008)" and
/// "hunger" both normalize to "hunger".
fn normalize_title(s: &str) -> String {
    s.chars()
        .filter_map(|c| {
            let c = c.to_ascii_lowercase();
            match c {
                'à' | 'â' | 'ä' => Some('a'),
                'é' | 'è' | 'ê' | 'ë' => Some('e'),
                'î' | 'ï' => Some('i'),
                'ô' | 'ö' => Some('o'),
                'û' | 'ü' | 'ù' => Some('u'),
                'ç' => Some('c'),
                'a'..='z' | '0'..='9' => Some(c),
                _ => None,
            }
        })
        .collect()
}

/// High-quality poster from TMDB without an API key: query the public website
/// search JSON (`/search/trending`) and pick the poster for a result that
/// **actually matches** the queried title (`movie` / `tv`). We require an exact
/// normalized title match so an ambiguous/misnamed file (e.g. a folder named
/// after an actor) never gets a random poster — when nothing confidently
/// matches we return None and the caller keeps the existing poster.
async fn tmdb_poster_url(
    client: &reqwest::Client,
    title: &str,
    year: Option<i32>,
    media_type: &str,
) -> Option<String> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    let want = normalize_title(title);
    if want.is_empty() {
        return None;
    }
    let resp = client
        .get("https://www.themoviedb.org/search/trending")
        .query(&[("query", title)])
        .header(
            "User-Agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        )
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    let results = json.get("results")?.as_array()?;

    let year_str = year.map(|y| y.to_string());
    // Only consider results whose title matches exactly (after normalization).
    let mut matched: Option<String> = None;
    for r in results {
        if r.get("media_type").and_then(|v| v.as_str()) != Some(media_type) {
            continue;
        }
        let cand = r
            .get("title")
            .or_else(|| r.get("name"))
            .or_else(|| r.get("original_title"))
            .or_else(|| r.get("original_name"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if normalize_title(cand) != want {
            continue;
        }
        let path = match r.get("poster_path").and_then(|v| v.as_str()) {
            Some(p) if !p.is_empty() => p,
            _ => continue,
        };
        let url = format!("https://image.tmdb.org/t/p/w500{path}");
        // An exact title + year match is the strongest signal — return at once.
        if let Some(ref ys) = year_str {
            let date = r
                .get("release_date")
                .or_else(|| r.get("first_air_date"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if date.starts_with(ys.as_str()) {
                return Some(url);
            }
        }
        // First title match becomes the fallback if no year match surfaces.
        if matched.is_none() {
            matched = Some(url);
        }
    }
    matched
}

/// Charge la langue depuis la DB (priorité) ou la config.
async fn load_language(db: &PgPool, settings: &Arc<Settings>) -> String {
    sqlx::query_scalar!(
        "SELECT value FROM media.settings WHERE key = 'metadata_language'"
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .filter(|l| !l.is_empty())
    .unwrap_or_else(|| settings.metadata.metadata_language.clone())
}

/// Démarre les workers d'enrichissement metadata en arrière-plan.
pub async fn start(db: PgPool, settings: Arc<Settings>) {
    let db_movies = db.clone();
    let s_movies  = settings.clone();
    tokio::spawn(async move {
        loop {
            match enrich_pending(&db_movies, &s_movies).await {
                Ok(n) if n > 0 => tracing::info!(n, "Enrichissement films (Wikidata) terminé"),
                Ok(_) => {}
                Err(e) => tracing::error!(error = %e, "Erreur enrichissement films"),
            }
            sleep(Duration::from_secs(300)).await;
        }
    });

    let db_shows = db.clone();
    let s_shows  = settings.clone();
    tokio::spawn(async move {
        loop {
            match enrich_pending_shows(&db_shows, &s_shows).await {
                Ok(n) if n > 0 => tracing::info!(n, "Enrichissement séries (TVMaze) terminé"),
                Ok(_) => {}
                Err(e) => tracing::error!(error = %e, "Erreur enrichissement séries"),
            }
            sleep(Duration::from_secs(300)).await;
        }
    });
}

// ── Movies ────────────────────────────────────────────────────────────────────

pub async fn enrich_pending(db: &PgPool, settings: &Arc<Settings>) -> Result<usize> {
    let language = load_language(db, settings).await;
    let client   = build_http_client()?;

    let movies = sqlx::query!(
        r#"SELECT id, title, file_path FROM media.movies
           WHERE meta_status = 'pending_meta'
           ORDER BY created_at DESC
           LIMIT 20"#
    )
    .fetch_all(db)
    .await?;

    let count = movies.len();

    for movie in movies {
        sqlx::query!(
            "UPDATE media.movies SET meta_status = 'fetching' WHERE id = $1",
            movie.id
        )
        .execute(db)
        .await?;

        let filename = std::path::Path::new(&movie.file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&movie.title);
        let (parsed_title, year) = parse_video_filename(filename);
        let search_title = if parsed_title.is_empty() { &movie.title } else { &parsed_title };

        let wikidata = WikidataService::new(client.clone(), language.clone());
        match enrich_movie_wikidata(db, &client, &wikidata, movie.id, search_title, year, &language).await {
            Ok(_) => tracing::info!(title = %search_title, "Metadata Wikidata OK"),
            Err(e) => {
                tracing::warn!(error = %e, title = %search_title, "Wikidata échoué, marqué error_meta");
                sqlx::query!(
                    "UPDATE media.movies SET meta_status = 'error_meta' WHERE id = $1",
                    movie.id
                )
                .execute(db)
                .await?;
            }
        }

        sleep(Duration::from_millis(300)).await;
    }

    Ok(count)
}

async fn enrich_movie_wikidata(
    db:       &PgPool,
    client:   &reqwest::Client,
    wikidata: &WikidataService,
    id:       uuid::Uuid,
    title:    &str,
    year:     Option<i32>,
    language: &str,
) -> Result<()> {
    // Always also try English unless it's already the configured language
    let extra: &[&str] = if language.starts_with("en") { &[] } else { &["en"] };
    let result = wikidata.search_movie_combined(title, year, extra).await?
        .ok_or_else(|| anyhow::anyhow!("Aucun résultat Wikidata/Wikipedia pour '{title}'"))?;

    // Fetch crew, rating, and all poster URLs (best-effort — don't fail the whole enrichment)
    let extras = wikidata.wikidata_movie_extras(title, year).await.unwrap_or_else(|e| {
        tracing::warn!(error = %e, title, "wikidata_movie_extras échoué, on continue sans");
        crate::services::wikidata::WikidataMovieExtras {
            directors:      vec![],
            writers:        vec![],
            producers:      vec![],
            content_rating: None,
            poster_urls:    vec![],
        }
    });

    let release_date: Option<chrono::NaiveDate> = result.release_year.map(|y| {
        chrono::NaiveDate::from_ymd_opt(y, 1, 1).unwrap_or_default()
    });

    // Build crew JSON: [{name, job}]
    let mut crew_entries: Vec<serde_json::Value> = Vec::new();
    for d in &extras.directors {
        crew_entries.push(serde_json::json!({"name": d, "job": "Director"}));
    }
    for w in &extras.writers {
        crew_entries.push(serde_json::json!({"name": w, "job": "Screenplay"}));
    }
    for p in &extras.producers {
        crew_entries.push(serde_json::json!({"name": p, "job": "Producer"}));
    }
    let crew_json = serde_json::Value::Array(crew_entries);

    // High-quality TMDB poster (no API key) preferred over the Wikipedia one.
    // Match against Wikidata's clean canonical title (not the raw file title,
    // which carries "(film, 2008)" noise) so we only accept a confident match.
    let movie_match = result.title.as_deref().unwrap_or(title);
    let tmdb_poster =
        tmdb_poster_url(client, movie_match, year.or(result.release_year), "movie").await;

    // Collect all poster URLs: TMDB first, then Wikidata extras, then the Wikipedia poster.
    let mut all_posters: Vec<String> = Vec::new();
    if let Some(ref t) = tmdb_poster { all_posters.push(t.clone()); }
    for u in &extras.poster_urls {
        if !all_posters.contains(u) { all_posters.push(u.clone()); }
    }
    if let Some(ref wiki_poster) = result.poster_url {
        if !all_posters.contains(wiki_poster) { all_posters.push(wiki_poster.clone()); }
    }
    // Main poster: TMDB if found, else the Wikipedia one.
    let main_poster = tmdb_poster.clone().or_else(|| result.poster_url.clone());

    sqlx::query!(
        r#"UPDATE media.movies
           SET title          = COALESCE($2, title),
               overview       = $3,
               poster_path    = COALESCE($4, poster_path),
               genres         = $5,
               release_date   = COALESCE($6, release_date),
               content_rating = $7,
               poster_urls    = $8,
               crew_json      = $9,
               meta_status    = 'ready',
               updated_at     = NOW()
           WHERE id = $1"#,
        id,
        result.title,
        result.overview,
        main_poster,
        &result.genres,
        release_date,
        extras.content_rating,
        &all_posters,
        crew_json,
    )
    .execute(db)
    .await?;

    Ok(())
}

// ── TV Shows ──────────────────────────────────────────────────────────────────

pub async fn enrich_pending_shows(db: &PgPool, settings: &Arc<Settings>) -> Result<usize> {
    let language = load_language(db, settings).await;
    let client   = build_http_client()?;
    let tvmaze = TvMazeService::new(client.clone());

    let shows = sqlx::query!(
        r#"SELECT id, name FROM media.tv_shows
           WHERE meta_status = 'pending_meta'
           ORDER BY created_at DESC
           LIMIT 10"#
    )
    .fetch_all(db)
    .await?;

    let count = shows.len();

    for show in shows {
        sqlx::query!(
            "UPDATE media.tv_shows SET meta_status = 'fetching' WHERE id = $1",
            show.id
        )
        .execute(db)
        .await?;

        match enrich_show_tvmaze(db, &client, &tvmaze, show.id, &show.name).await {
            Ok(_) => tracing::info!(name = %show.name, "Metadata TVMaze OK"),
            Err(e) => {
                tracing::warn!(error = %e, name = %show.name, "TVMaze échoué, essai Wikidata");
                let wikidata = WikidataService::new(client.clone(), language.clone());
                match enrich_show_wikidata(db, &client, &wikidata, show.id, &show.name, &language).await {
                    Ok(_) => tracing::info!(name = %show.name, "Metadata Wikidata série OK"),
                    Err(e2) => {
                        tracing::warn!(error = %e2, name = %show.name, "Wikidata série échoué");
                        sqlx::query!(
                            "UPDATE media.tv_shows SET meta_status = 'error_meta' WHERE id = $1",
                            show.id
                        )
                        .execute(db)
                        .await?;
                    }
                }
            }
        }

        sleep(Duration::from_millis(200)).await;
    }

    Ok(count)
}

async fn enrich_show_tvmaze(
    db:      &PgPool,
    client:  &reqwest::Client,
    tvmaze:  &TvMazeService,
    show_id: uuid::Uuid,
    name:    &str,
) -> Result<()> {
    let results = tvmaze.search_show(name).await?;
    let tvmaze_id = results
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("Aucun résultat TVMaze pour '{name}'"))?
        .show
        .id;

    // Fetch show+episodes and season details in parallel
    let (show, seasons_meta) = tokio::join!(
        tvmaze.get_show_with_episodes(tvmaze_id),
        tvmaze.get_show_seasons(tvmaze_id),
    );
    let show = show?;
    let seasons_meta = seasons_meta.unwrap_or_default();

    let tvmaze_poster = show.image.as_ref()
        .and_then(|img| img.original.as_ref().or(img.medium.as_ref()))
        .cloned();

    let overview = show.summary.as_deref().map(tvmaze::strip_html);

    let first_air_date: Option<chrono::NaiveDate> = show.premiered
        .as_deref()
        .filter(|s| !s.is_empty())
        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

    // Prefer a high-quality TMDB poster over the TVMaze one. Match against the
    // canonical TVMaze name (confident match only) — otherwise keep TVMaze's.
    let show_year = first_air_date.map(|d| d.format("%Y").to_string().parse::<i32>().unwrap_or(0)).filter(|y| *y > 0);
    let poster_url = tmdb_poster_url(client, &show.name, show_year, "tv").await.or(tvmaze_poster);

    let networks: Vec<String> = show.network
        .map(|n| vec![n.name])
        .unwrap_or_default();

    sqlx::query!(
        r#"UPDATE media.tv_shows
           SET name           = $2,
               overview       = $3,
               poster_path    = $4,
               first_air_date = $5,
               status         = $6,
               genres         = $7,
               networks       = $8,
               meta_status    = 'ready',
               updated_at     = NOW()
           WHERE id = $1"#,
        show_id,
        show.name,
        overview,
        poster_url,
        first_air_date,
        show.status,
        &show.genres,
        &networks,
    )
    .execute(db)
    .await?;

    // Upsert seasons with full metadata from the /seasons endpoint
    for sm in &seasons_meta {
        let season_air_date: Option<chrono::NaiveDate> = sm.premiere_date
            .as_deref()
            .filter(|s| !s.is_empty())
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

        let season_poster = sm.image.as_ref()
            .and_then(|img| img.original.as_ref().or(img.medium.as_ref()))
            .cloned();

        let season_overview = sm.summary.as_deref().map(tvmaze::strip_html);

        sqlx::query!(
            r#"INSERT INTO media.tv_seasons (show_id, season_number, name, overview, air_date, poster_path)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (show_id, season_number) DO UPDATE
               SET name          = EXCLUDED.name,
                   overview      = EXCLUDED.overview,
                   air_date      = EXCLUDED.air_date,
                   poster_path   = EXCLUDED.poster_path,
                   episode_count = (
                       SELECT COUNT(*) FROM media.tv_episodes
                       WHERE season_id = media.tv_seasons.id
                   )"#,
            show_id,
            sm.number,
            sm.name.as_deref().filter(|s| !s.is_empty()),
            season_overview,
            season_air_date,
            season_poster,
        )
        .execute(db)
        .await?;
    }

    // If seasons_meta was empty (shouldn't happen but just in case), fall back to episode-derived seasons
    if seasons_meta.is_empty() {
        if let Some(episodes) = show.embedded.as_ref().and_then(|e| e.episodes.as_ref()) {
            let season_numbers: Vec<i32> = episodes
                .iter()
                .map(|e| e.season)
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            for sn in season_numbers {
                sqlx::query!(
                    r#"INSERT INTO media.tv_seasons (show_id, season_number)
                       VALUES ($1, $2)
                       ON CONFLICT (show_id, season_number) DO NOTHING"#,
                    show_id,
                    sn,
                )
                .execute(db)
                .await?;
            }
        }
    }

    // Update episodes
    if let Some(episodes) = show.embedded.and_then(|e| e.episodes) {
        for ep in &episodes {
            let Some(ep_num) = ep.number else { continue };

            let air_date: Option<chrono::NaiveDate> = ep.airdate
                .as_deref()
                .filter(|s| !s.is_empty())
                .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

            let still_url = ep.image.as_ref()
                .and_then(|img| img.original.as_ref().or(img.medium.as_ref()))
                .cloned();

            let ep_overview = ep.summary.as_deref().map(tvmaze::strip_html);

            sqlx::query!(
                r#"UPDATE media.tv_episodes
                   SET name        = COALESCE($4, name),
                       air_date    = $5,
                       still_path  = $6,
                       overview    = $7,
                       meta_status = 'ready',
                       updated_at  = NOW()
                   WHERE show_id = $1
                     AND episode_number = $2
                     AND season_id IN (
                         SELECT id FROM media.tv_seasons
                         WHERE show_id = $1 AND season_number = $3
                     )"#,
                show_id,
                ep_num,
                ep.season,
                ep.name,
                air_date,
                still_url,
                ep_overview,
            )
            .execute(db)
            .await?;
        }
    }

    // Refresh counts
    sqlx::query!(
        r#"UPDATE media.tv_shows
           SET season_count  = (SELECT COUNT(*) FROM media.tv_seasons WHERE show_id = $1),
               episode_count = (SELECT COUNT(*) FROM media.tv_episodes WHERE show_id = $1)
           WHERE id = $1"#,
        show_id,
    )
    .execute(db)
    .await?;

    Ok(())
}

async fn enrich_show_wikidata(
    db:       &PgPool,
    client:   &reqwest::Client,
    wikidata: &WikidataService,
    show_id:  uuid::Uuid,
    name:     &str,
    language: &str,
) -> Result<()> {
    let extra: &[&str] = if language.starts_with("en") { &[] } else { &["en"] };
    let result: WikidataShowResult = wikidata.search_show_combined(name, None, extra).await?
        .ok_or_else(|| anyhow::anyhow!("Aucun résultat Wikidata/Wikipedia pour la série '{name}'"))?;

    // Prefer a high-quality TMDB poster over the Wikipedia one (confident match
    // against the canonical Wikidata title only — otherwise keep Wikipedia's).
    let match_name = result.title.as_deref().unwrap_or(name);
    let poster = tmdb_poster_url(client, match_name, None, "tv")
        .await
        .or_else(|| result.poster_url.clone());

    sqlx::query!(
        r#"UPDATE media.tv_shows
           SET name        = COALESCE($2, name),
               overview    = $3,
               poster_path = $4,
               genres      = $5,
               networks    = $6,
               meta_status = 'ready',
               updated_at  = NOW()
           WHERE id = $1"#,
        show_id,
        result.title,
        result.overview,
        poster,
        &result.genres,
        &result.networks,
    )
    .execute(db)
    .await?;

    Ok(())
}
