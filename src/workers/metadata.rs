use anyhow::Result;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;

use crate::{
    config::Settings,
    services::{
        musicbrainz::MusicBrainzService,
        scanner::parse_video_filename,
        theaudiodb,
        tmdb::{self, TmdbCandidate, TmdbService},
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

/// Loads the language from the DB (priority) or from the config.
pub async fn load_language(db: &PgPool, settings: &Arc<Settings>) -> String {
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

/// MusicBrainz partial dates ("1969", "1969-03", "1969-03-12") → NaiveDate.
fn parse_partial_date(s: &str) -> Option<chrono::NaiveDate> {
    let mut parts = s.splitn(3, '-');
    let y: i32 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(1);
    let d: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(1);
    chrono::NaiveDate::from_ymd_opt(y, m, d)
}

/// TMDB expects a locale ("fr-FR"); the module config stores a short language.
fn tmdb_locale(language: &str) -> String {
    if language.contains('-') {
        return language.to_string();
    }
    match language {
        "fr" => "fr-FR".into(),
        "en" => "en-US".into(),
        "de" => "de-DE".into(),
        "es" => "es-ES".into(),
        "it" => "it-IT".into(),
        "pt" => "pt-PT".into(),
        l => format!("{l}-{}", l.to_uppercase()),
    }
}

/// Country code used for certifications, from the metadata language.
fn cert_country(language: &str) -> String {
    tmdb_locale(language)
        .split('-')
        .nth(1)
        .unwrap_or("US")
        .to_string()
}

/// OMDb API key (DB setting wins over config). Empty string = disabled.
pub async fn load_omdb_key(db: &PgPool, settings: &Arc<Settings>) -> String {
    sqlx::query_scalar!(
        "SELECT value FROM media.settings WHERE key = 'omdb_api_key'"
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .map(|k| k.trim().to_string())
    .filter(|k| !k.is_empty())
    .unwrap_or_else(|| settings.metadata.omdb_api_key.trim().to_string())
}

/// Best-effort multi-source ratings (Rotten Tomatoes / IMDb / Metacritic via
/// OMDb) for an already-enriched movie or show. Looks up by stored imdb_id
/// when present (exact), else by title/year.
pub async fn apply_omdb_ratings(
    db:       &PgPool,
    client:   &reqwest::Client,
    api_key:  &str,
    id:       uuid::Uuid,
    is_movie: bool,
) {
    if api_key.is_empty() {
        return;
    }
    let (title, year, imdb_id) = if is_movie {
        match sqlx::query!(
            "SELECT title, imdb_id, EXTRACT(YEAR FROM release_date)::int AS year FROM media.movies WHERE id = $1",
            id
        )
        .fetch_optional(db)
        .await
        {
            Ok(Some(r)) => (r.title, r.year, r.imdb_id),
            _ => return,
        }
    } else {
        match sqlx::query!(
            "SELECT name AS title, NULL::varchar AS imdb_id, EXTRACT(YEAR FROM first_air_date)::int AS year FROM media.tv_shows WHERE id = $1",
            id
        )
        .fetch_optional(db)
        .await
        {
            Ok(Some(r)) => (r.title, r.year, r.imdb_id),
            _ => return,
        }
    };

    let kind = if is_movie { "movie" } else { "series" };
    let Some(ratings) = crate::services::omdb::fetch_ratings(
        client, api_key, imdb_id.as_deref(), &title, year, kind,
    )
    .await
    else {
        return;
    };

    // Persist ratings + the IMDb poster as an extra artwork candidate
    // (never overriding an existing poster, only filling gaps).
    let result = if is_movie {
        sqlx::query!(
            r#"UPDATE media.movies
               SET ratings_json = $2,
                   poster_path  = COALESCE(poster_path, $3),
                   poster_urls  = CASE WHEN $3::text IS NOT NULL AND NOT ($3 = ANY(poster_urls))
                                       THEN array_append(poster_urls, $3)
                                       ELSE poster_urls END
               WHERE id = $1"#,
            id,
            ratings.to_json(),
            ratings.poster,
        )
        .execute(db)
        .await
    } else {
        sqlx::query!(
            "UPDATE media.tv_shows SET ratings_json = $2, poster_path = COALESCE(poster_path, $3) WHERE id = $1",
            id,
            ratings.to_json(),
            ratings.poster,
        )
        .execute(db)
        .await
    };
    if let Err(e) = result {
        tracing::warn!(error = %e, %id, "Écriture des notes OMDb échouée");
        return;
    }
    tracing::info!(%id, kind, "Notes OMDb (RT/IMDb/Metacritic) appliquées");
}

/// Build the official TMDB API service when a key is configured — the
/// primary movie/show provider. The DB setting
/// `tmdb_api_key` overrides the config file.
pub async fn load_tmdb_service(
    db:       &PgPool,
    settings: &Arc<Settings>,
    client:   &reqwest::Client,
    language: &str,
) -> Option<TmdbService> {
    let key = sqlx::query_scalar!(
        "SELECT value FROM media.settings WHERE key = 'tmdb_api_key'"
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .map(|k| k.trim().to_string())
    .filter(|k| !k.is_empty())
    .unwrap_or_else(|| settings.metadata.tmdb_api_key.trim().to_string());

    if key.is_empty() {
        return None;
    }
    Some(TmdbService::new(
        client.clone(),
        key,
        settings.metadata.tmdb_base_url.clone(),
        tmdb_locale(language),
        settings.metadata.tmdb_image_base.clone(),
    ))
}

/// Démarre les workers d'enrichissement metadata en arrière-plan.
/// Failed items are retried up to 3 times (with a 1h cool-down) — see the
/// `retryable` predicate in each poller.
pub async fn start(db: PgPool, settings: Arc<Settings>) {
    let db_movies = db.clone();
    let s_movies  = settings.clone();
    tokio::spawn(async move {
        loop {
            match enrich_pending(&db_movies, &s_movies).await {
                Ok(n) if n > 0 => tracing::info!(n, "Enrichissement films terminé"),
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
                Ok(n) if n > 0 => tracing::info!(n, "Enrichissement séries terminé"),
                Ok(_) => {}
                Err(e) => tracing::error!(error = %e, "Erreur enrichissement séries"),
            }
            sleep(Duration::from_secs(300)).await;
        }
    });

    // Music: artists + albums via MusicBrainz (rate-limited to ~1 req/s,
    // so batches are intentionally small).
    tokio::spawn(async move {
        loop {
            match enrich_pending_artists(&db, &settings).await {
                Ok(n) if n > 0 => tracing::info!(n, "Enrichissement artistes (MusicBrainz) terminé"),
                Ok(_) => {}
                Err(e) => tracing::error!(error = %e, "Erreur enrichissement artistes"),
            }
            match enrich_pending_albums(&db, &settings).await {
                Ok(n) if n > 0 => tracing::info!(n, "Enrichissement albums (MusicBrainz) terminé"),
                Ok(_) => {}
                Err(e) => tracing::error!(error = %e, "Erreur enrichissement albums"),
            }
            sleep(Duration::from_secs(300)).await;
        }
    });
}

// ── Movies ────────────────────────────────────────────────────────────────────

pub async fn enrich_pending(db: &PgPool, settings: &Arc<Settings>) -> Result<usize> {
    let language = load_language(db, settings).await;
    let client   = build_http_client()?;
    let tmdb_api = load_tmdb_service(db, settings, &client, &language).await;
    let omdb_key = load_omdb_key(db, settings).await;

    let movies = sqlx::query!(
        r#"SELECT id, title, file_path, tmdb_id FROM media.movies
           WHERE NOT meta_locked
             AND (meta_status = 'pending_meta'
                  OR (meta_status = 'error_meta' AND meta_retries < 3
                      AND updated_at < NOW() - INTERVAL '1 hour'))
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
        let search_title = if parsed_title.is_empty() { movie.title.clone() } else { parsed_title };

        let stored_tmdb = movie.tmdb_id.map(|t| t as i64);

        // Official TMDB API first (primary provider), then the
        // keyless TMDB + Wikidata/Wikipedia fallback chain.
        let mut result: Result<()> = Err(anyhow::anyhow!("no provider"));
        if let Some(svc) = &tmdb_api {
            result = enrich_movie_api(db, svc, movie.id, &search_title, year, stored_tmdb, &language).await;
            if let Err(e) = &result {
                tracing::warn!(error = %e, title = %search_title, "TMDB API échoué, repli keyless/Wikidata");
            }
        }
        if result.is_err() {
            let wikidata = WikidataService::new(client.clone(), language.clone());
            result = enrich_movie(db, &client, &wikidata, movie.id, &search_title, year, stored_tmdb, &language).await;
        }

        match result {
            Ok(_) => {
                tracing::info!(title = %search_title, "Metadata film OK");
                apply_omdb_ratings(db, &client, &omdb_key, movie.id, true).await;
            }
            Err(e) => {
                tracing::warn!(error = %e, title = %search_title, "Enrichissement film échoué, marqué error_meta");
                sqlx::query!(
                    "UPDATE media.movies SET meta_status = 'error_meta', meta_retries = meta_retries + 1 WHERE id = $1",
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

/// Full enrichment from the official TMDB API (localized text, genres, cast
/// with photos, crew, tagline, runtime, trailer, certification, imdb_id).
/// Re-matches by stored `tmdb_id` when available, else searches by title.
pub async fn enrich_movie_api(
    db:          &PgPool,
    svc:         &TmdbService,
    id:          uuid::Uuid,
    title:       &str,
    year:        Option<i32>,
    stored_tmdb: Option<i64>,
    language:    &str,
) -> Result<()> {
    let tmdb_id = match stored_tmdb {
        Some(t) => t as i32,
        None => {
            let results = svc.search_movie(title, year).await?;
            let want = tmdb::normalize_title(title);
            results
                .iter()
                // Prefer a confident normalized-title match, else TMDB's top hit.
                .find(|m| {
                    tmdb::normalize_title(&m.title) == want
                        || m.original_title.as_deref().map(tmdb::normalize_title) == Some(want.clone())
                })
                .or_else(|| results.first())
                .map(|m| m.id)
                .ok_or_else(|| anyhow::anyhow!("Aucun résultat TMDB pour '{title}'"))?
        }
    };

    let movie = svc.get_movie_details(tmdb_id).await?;

    let poster   = movie.poster_path.as_deref().map(|p| svc.poster_url(p, "w500"));
    let backdrop = movie.backdrop_path.as_deref().map(|p| svc.poster_url(p, "w1280"));
    let release_date = movie.release_date
        .as_deref()
        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let genres: Vec<String> = movie.genres.as_deref().unwrap_or_default()
        .iter().map(|g| g.name.clone()).collect();
    let countries: Vec<String> = movie.production_countries.as_deref().unwrap_or_default()
        .iter().map(|c| c.iso_3166_1.clone()).collect();

    let cast_json: serde_json::Value = movie.credits.as_ref()
        .map(|c| {
            let mut cast: Vec<_> = c.cast.iter().collect();
            cast.sort_by_key(|m| m.order.unwrap_or(i32::MAX));
            serde_json::Value::Array(
                cast.into_iter().take(20).map(|m| serde_json::json!({
                    "name":         m.name,
                    "character":    m.character,
                    "profile_path": m.profile_path.as_deref().map(|p| svc.poster_url(p, "w185")),
                    "order":        m.order,
                })).collect()
            )
        })
        .unwrap_or_else(|| serde_json::Value::Array(vec![]));

    const CREW_JOBS: &[&str] = &["Director", "Screenplay", "Writer", "Producer"];
    let crew_json: serde_json::Value = movie.credits.as_ref()
        .map(|c| serde_json::Value::Array(
            c.crew.iter()
                .filter(|m| m.job.as_deref().map(|j| CREW_JOBS.contains(&j)).unwrap_or(false))
                .map(|m| serde_json::json!({"name": m.name, "job": m.job}))
                .collect()
        ))
        .unwrap_or_else(|| serde_json::Value::Array(vec![]));

    let trailer_key    = movie.trailer_key();
    let content_rating = movie.certification(&cert_country(language));

    sqlx::query!(
        r#"UPDATE media.movies
           SET title                = $2,
               original_title       = $3,
               overview             = COALESCE(NULLIF($4, ''), overview),
               tagline              = COALESCE(NULLIF($5, ''), tagline),
               release_date         = COALESCE($6, release_date),
               runtime_mins         = COALESCE($7, runtime_mins),
               poster_path          = COALESCE($8, poster_path),
               backdrop_path        = COALESCE($9, backdrop_path),
               vote_average         = COALESCE(CAST($10::float8 AS numeric(3,1)), vote_average),
               vote_count           = COALESCE($11, vote_count),
               popularity           = COALESCE(CAST($12::float8 AS numeric(10,3)), popularity),
               genres               = CASE WHEN cardinality($13::text[]) > 0 THEN $13 ELSE genres END,
               original_language    = COALESCE($14, original_language),
               production_countries = CASE WHEN cardinality($15::text[]) > 0 THEN $15 ELSE production_countries END,
               imdb_id              = COALESCE($16, imdb_id),
               cast_json            = $17,
               crew_json            = CASE WHEN jsonb_array_length($18) > 0 THEN $18 ELSE crew_json END,
               trailer_key          = COALESCE($19, trailer_key),
               content_rating       = COALESCE($20, content_rating),
               tmdb_id              = $21,
               poster_urls          = CASE WHEN $8::text IS NOT NULL AND NOT ($8 = ANY(poster_urls)) THEN array_prepend($8, poster_urls) ELSE poster_urls END,
               meta_status          = 'ready',
               meta_retries         = 0,
               updated_at           = NOW()
           WHERE id = $1"#,
        id,
        movie.title,
        movie.original_title,
        movie.overview.unwrap_or_default(),
        movie.tagline.unwrap_or_default(),
        release_date,
        movie.runtime,
        poster,
        backdrop,
        movie.vote_average,
        movie.vote_count,
        movie.popularity,
        &genres,
        movie.original_language,
        &countries,
        movie.imdb_id,
        cast_json,
        crew_json,
        trailer_key,
        content_rating,
        movie.id,
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Enrich a movie from Wikidata/Wikipedia (localized text, crew, rating)
/// merged with the keyless TMDB search (id, posters, backdrop, votes).
/// Either provider alone is enough — we only fail when both come up empty.
#[allow(clippy::too_many_arguments)]
async fn enrich_movie(
    db:          &PgPool,
    client:      &reqwest::Client,
    wikidata:    &WikidataService,
    id:          uuid::Uuid,
    title:       &str,
    year:        Option<i32>,
    stored_tmdb: Option<i64>,
    language:    &str,
) -> Result<()> {
    // Always also try English unless it's already the configured language
    let extra: &[&str] = if language.starts_with("en") { &[] } else { &["en"] };
    let wiki = wikidata.search_movie_combined(title, year, extra).await.ok().flatten();

    // Match TMDB against Wikidata's clean canonical title when available
    // (the raw file title carries "(film, 2008)"-style noise).
    let match_title = wiki
        .as_ref()
        .and_then(|w| w.title.clone())
        .unwrap_or_else(|| title.to_string());
    let wiki_year = wiki.as_ref().and_then(|w| w.release_year);

    // With a stored tmdb_id we re-match strictly by ID (stable across renames);
    // otherwise we require a confident normalized-title match.
    let candidate: Option<TmdbCandidate> = match stored_tmdb {
        Some(tid) => tmdb::find_keyless_by_id(client, &match_title, "movie", tid).await,
        None => {
            let cands = tmdb::search_keyless(client, &match_title, "movie").await;
            tmdb::best_match(&cands, &match_title, year.or(wiki_year)).cloned()
        }
    };

    if wiki.is_none() && candidate.is_none() {
        anyhow::bail!("Aucun résultat Wikidata/TMDB pour '{title}'");
    }

    // Crew / content rating / extra posters (best-effort, Wikidata only)
    let extras = wikidata
        .wikidata_movie_extras(title, year)
        .await
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, title, "wikidata_movie_extras échoué, on continue sans");
            crate::services::wikidata::WikidataMovieExtras {
                directors:      vec![],
                writers:        vec![],
                producers:      vec![],
                content_rating: None,
                poster_urls:    vec![],
            }
        });

    let final_title = wiki
        .as_ref()
        .and_then(|w| w.title.clone())
        .or_else(|| candidate.as_ref().map(|c| c.title.clone()));
    // Overview: prefer the localized Wikipedia extract, fall back to TMDB's.
    let overview = wiki
        .as_ref()
        .and_then(|w| w.overview.clone())
        .or_else(|| candidate.as_ref().and_then(|c| c.overview.clone()));
    let genres: Vec<String> = wiki.as_ref().map(|w| w.genres.clone()).unwrap_or_default();

    let release_year = wiki_year.or(candidate.as_ref().and_then(|c| c.year)).or(year);
    let release_date: Option<chrono::NaiveDate> =
        release_year.and_then(|y| chrono::NaiveDate::from_ymd_opt(y, 1, 1));

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

    // Collect all poster URLs: TMDB first, then Wikidata extras, then Wikipedia.
    let tmdb_poster = candidate.as_ref().and_then(|c| c.poster_url.clone());
    let mut all_posters: Vec<String> = Vec::new();
    if let Some(ref t) = tmdb_poster { all_posters.push(t.clone()); }
    for u in &extras.poster_urls {
        if !all_posters.contains(u) { all_posters.push(u.clone()); }
    }
    if let Some(wiki_poster) = wiki.as_ref().and_then(|w| w.poster_url.clone()) {
        if !all_posters.contains(&wiki_poster) { all_posters.push(wiki_poster); }
    }
    let main_poster = tmdb_poster.or_else(|| wiki.as_ref().and_then(|w| w.poster_url.clone()));

    sqlx::query!(
        r#"UPDATE media.movies
           SET title          = COALESCE($2, title),
               overview       = COALESCE($3, overview),
               poster_path    = COALESCE($4, poster_path),
               genres         = CASE WHEN cardinality($5::text[]) > 0 THEN $5 ELSE genres END,
               release_date   = COALESCE($6, release_date),
               content_rating = COALESCE($7, content_rating),
               poster_urls    = $8,
               crew_json      = $9,
               tmdb_id        = COALESCE($10, tmdb_id),
               backdrop_path  = COALESCE($11, backdrop_path),
               vote_average   = COALESCE(CAST($12::float8 AS numeric(3,1)), vote_average),
               vote_count     = COALESCE($13, vote_count),
               meta_status    = 'ready',
               meta_retries   = 0,
               updated_at     = NOW()
           WHERE id = $1"#,
        id,
        final_title,
        overview,
        main_poster,
        &genres,
        release_date,
        extras.content_rating,
        &all_posters,
        crew_json,
        candidate.as_ref().and_then(|c| c.tmdb_id.map(|t| t as i32)),
        candidate.as_ref().and_then(|c| c.backdrop_url.clone()),
        candidate.as_ref().and_then(|c| c.vote_average),
        candidate.as_ref().and_then(|c| c.vote_count.map(|v| v as i32)),
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Apply a manually chosen candidate to a movie (Identify flow), then
/// complete crew/rating/genres from Wikidata using the canonical title.
pub async fn apply_movie_candidate(
    db:        &PgPool,
    settings:  &Arc<Settings>,
    id:        uuid::Uuid,
    candidate: &TmdbCandidate,
) -> Result<()> {
    let language = load_language(db, settings).await;
    let client   = build_http_client()?;
    let wikidata = WikidataService::new(client.clone(), language.clone());

    sqlx::query!(
        "UPDATE media.movies SET tmdb_id = COALESCE($2, tmdb_id), meta_status = 'fetching', meta_retries = 0 WHERE id = $1",
        id,
        candidate.tmdb_id.map(|t| t as i32),
    )
    .execute(db)
    .await?;

    // With an API key and a TMDB id, the official API gives the richest data.
    if let (Some(svc), Some(tid)) = (
        load_tmdb_service(db, settings, &client, &language).await,
        candidate.tmdb_id,
    ) {
        if enrich_movie_api(db, &svc, id, &candidate.title, candidate.year, Some(tid), &language)
            .await
            .is_ok()
        {
            let omdb_key = load_omdb_key(db, settings).await;
            apply_omdb_ratings(db, &client, &omdb_key, id, true).await;
            return Ok(());
        }
    }

    if let Err(e) = enrich_movie(
        db, &client, &wikidata, id,
        &candidate.title, candidate.year, candidate.tmdb_id, &language,
    )
    .await
    {
        tracing::warn!(error = %e, "Wikidata indisponible pendant l'identification, application du candidat TMDB seul");
        // Still apply what the candidate itself carries.
        let release_date = candidate
            .year
            .and_then(|y| chrono::NaiveDate::from_ymd_opt(y, 1, 1));
        sqlx::query!(
            r#"UPDATE media.movies
               SET title         = $2,
                   overview      = COALESCE($3, overview),
                   poster_path   = COALESCE($4, poster_path),
                   backdrop_path = COALESCE($5, backdrop_path),
                   release_date  = COALESCE($6, release_date),
                   vote_average  = COALESCE(CAST($7::float8 AS numeric(3,1)), vote_average),
                   vote_count    = COALESCE($8, vote_count),
                   meta_status   = 'ready',
                   updated_at    = NOW()
               WHERE id = $1"#,
            id,
            candidate.title,
            candidate.overview,
            candidate.poster_url,
            candidate.backdrop_url,
            release_date,
            candidate.vote_average,
            candidate.vote_count.map(|v| v as i32),
        )
        .execute(db)
        .await?;
    }

    let omdb_key = load_omdb_key(db, settings).await;
    apply_omdb_ratings(db, &client, &omdb_key, id, true).await;
    Ok(())
}

// ── TV Shows ──────────────────────────────────────────────────────────────────

pub async fn enrich_pending_shows(db: &PgPool, settings: &Arc<Settings>) -> Result<usize> {
    let language = load_language(db, settings).await;
    let client   = build_http_client()?;
    let tvmaze = TvMazeService::new(client.clone());

    let tmdb_api = load_tmdb_service(db, settings, &client, &language).await;
    let omdb_key = load_omdb_key(db, settings).await;

    let shows = sqlx::query!(
        r#"SELECT id, name, tvmaze_id FROM media.tv_shows
           WHERE NOT meta_locked
             AND (meta_status = 'pending_meta'
                  OR (meta_status = 'error_meta' AND meta_retries < 3
                      AND updated_at < NOW() - INTERVAL '1 hour'))
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

        match enrich_show_tvmaze(db, &client, &tvmaze, show.id, &show.name, show.tvmaze_id).await {
            Ok(_) => {
                tracing::info!(name = %show.name, "Metadata TVMaze OK");
                // Official TMDB overlay: localized text, cast, better artwork
                // (primary show provider), on top of TVMaze episodes.
                if let Some(svc) = &tmdb_api {
                    if let Err(e) = overlay_show_tmdb(db, svc, show.id).await {
                        tracing::warn!(error = %e, name = %show.name, "Overlay TMDB série échoué (non bloquant)");
                    }
                }
                apply_omdb_ratings(db, &client, &omdb_key, show.id, false).await;
            }
            Err(e) => {
                tracing::warn!(error = %e, name = %show.name, "TVMaze échoué, essai Wikidata");
                let wikidata = WikidataService::new(client.clone(), language.clone());
                match enrich_show_wikidata(db, &client, &wikidata, show.id, &show.name, &language).await {
                    Ok(_) => tracing::info!(name = %show.name, "Metadata Wikidata série OK"),
                    Err(e2) => {
                        tracing::warn!(error = %e2, name = %show.name, "Wikidata série échoué");
                        sqlx::query!(
                            "UPDATE media.tv_shows SET meta_status = 'error_meta', meta_retries = meta_retries + 1 WHERE id = $1",
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

/// Enrich a show from TVMaze. When `stored_tvmaze_id` is present we fetch by
/// ID directly (stable re-match); otherwise we search by name and persist the
/// matched ID for future refreshes.
pub async fn enrich_show_tvmaze(
    db:      &PgPool,
    client:  &reqwest::Client,
    tvmaze:  &TvMazeService,
    show_id: uuid::Uuid,
    name:    &str,
    stored_tvmaze_id: Option<i32>,
) -> Result<()> {
    let tvmaze_id = match stored_tvmaze_id {
        Some(id) => id,
        None => tvmaze
            .search_show(name)
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("Aucun résultat TVMaze pour '{name}'"))?
            .show
            .id,
    };

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

    // TMDB keyless candidate (confident match on the canonical TVMaze name):
    // brings a high-quality poster + backdrop + community votes.
    let show_year = first_air_date.map(|d| d.format("%Y").to_string().parse::<i32>().unwrap_or(0)).filter(|y| *y > 0);
    let cands = tmdb::search_keyless(client, &show.name, "tv").await;
    let candidate = tmdb::best_match(&cands, &show.name, show_year).cloned();
    let poster_url = candidate
        .as_ref()
        .and_then(|c| c.poster_url.clone())
        .or(tvmaze_poster);

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
               tvmaze_id      = $9,
               backdrop_path  = COALESCE($10, backdrop_path),
               vote_average   = COALESCE(CAST($11::float8 AS numeric(3,1)), vote_average),
               vote_count     = COALESCE($12, vote_count),
               meta_status    = 'ready',
               meta_retries   = 0,
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
        tvmaze_id,
        candidate.as_ref().and_then(|c| c.backdrop_url.clone()),
        candidate.as_ref().and_then(|c| c.vote_average),
        candidate.as_ref().and_then(|c| c.vote_count.map(|v| v as i32)),
    )
    .execute(db)
    .await?;

    // tmdb_id is UNIQUE on tv_shows: the same show in two libraries would
    // violate it, so persist best-effort in a separate statement.
    if let Some(tid) = candidate.as_ref().and_then(|c| c.tmdb_id.map(|t| t as i32)) {
        let _ = sqlx::query!(
            "UPDATE media.tv_shows SET tmdb_id = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM media.tv_shows WHERE tmdb_id = $2 AND id <> $1)",
            show_id, tid
        )
        .execute(db)
        .await;
    }

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

/// Overlay official TMDB data on an already-enriched show: localized name and
/// overview, genres, networks, votes, artwork, and the cast with photos.
/// Matches by the stored tmdb_id when present, else searches by name.
async fn overlay_show_tmdb(
    db:      &PgPool,
    svc:     &TmdbService,
    show_id: uuid::Uuid,
) -> Result<()> {
    let row = sqlx::query!(
        "SELECT name, tmdb_id, first_air_date FROM media.tv_shows WHERE id = $1",
        show_id
    )
    .fetch_one(db)
    .await?;

    let tmdb_id = match row.tmdb_id {
        Some(t) => t,
        None => {
            let year = row.first_air_date.map(|d| chrono::Datelike::year(&d));
            let results = svc.search_show(&row.name, year).await?;
            let want = tmdb::normalize_title(&row.name);
            results
                .iter()
                .find(|s| tmdb::normalize_title(&s.name) == want
                    || s.original_name.as_deref().map(tmdb::normalize_title) == Some(want.clone()))
                .or_else(|| results.first())
                .map(|s| s.id)
                .ok_or_else(|| anyhow::anyhow!("Aucun résultat TMDB pour la série '{}'", row.name))?
        }
    };

    let show = svc.get_show_details(tmdb_id).await?;

    let poster   = show.poster_path.as_deref().map(|p| svc.poster_url(p, "w500"));
    let backdrop = show.backdrop_path.as_deref().map(|p| svc.poster_url(p, "w1280"));
    let genres: Vec<String> = show.genres.as_deref().unwrap_or_default()
        .iter().map(|g| g.name.clone()).collect();
    let networks: Vec<String> = show.networks.as_deref().unwrap_or_default()
        .iter().map(|n| n.name.clone()).collect();

    let cast_json: serde_json::Value = show.credits.as_ref()
        .map(|c| {
            let mut cast: Vec<_> = c.cast.iter().collect();
            cast.sort_by_key(|m| m.order.unwrap_or(i32::MAX));
            serde_json::Value::Array(
                cast.into_iter().take(20).map(|m| serde_json::json!({
                    "name":         m.name,
                    "character":    m.character,
                    "profile_path": m.profile_path.as_deref().map(|p| svc.poster_url(p, "w185")),
                    "order":        m.order,
                })).collect()
            )
        })
        .unwrap_or_else(|| serde_json::Value::Array(vec![]));

    sqlx::query!(
        r#"UPDATE media.tv_shows
           SET name          = $2,
               overview      = COALESCE(NULLIF($3, ''), overview),
               poster_path   = COALESCE($4, poster_path),
               backdrop_path = COALESCE($5, backdrop_path),
               vote_average  = COALESCE(CAST($6::float8 AS numeric(3,1)), vote_average),
               vote_count    = COALESCE($7, vote_count),
               genres        = CASE WHEN cardinality($8::text[]) > 0 THEN $8 ELSE genres END,
               networks      = CASE WHEN cardinality($9::text[]) > 0 THEN $9 ELSE networks END,
               cast_json     = CASE WHEN jsonb_array_length($10) > 0 THEN $10 ELSE cast_json END,
               updated_at    = NOW()
           WHERE id = $1"#,
        show_id,
        show.name,
        show.overview.unwrap_or_default(),
        poster,
        backdrop,
        show.vote_average,
        show.vote_count,
        &genres,
        &networks,
        cast_json,
    )
    .execute(db)
    .await?;

    // tmdb_id is UNIQUE — best-effort separate statement.
    let _ = sqlx::query!(
        "UPDATE media.tv_shows SET tmdb_id = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM media.tv_shows WHERE tmdb_id = $2 AND id <> $1)",
        show_id, show.id
    )
    .execute(db)
    .await;

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
    let cands = tmdb::search_keyless(client, match_name, "tv").await;
    let candidate = tmdb::best_match(&cands, match_name, result.first_air_year).cloned();
    let poster = candidate
        .as_ref()
        .and_then(|c| c.poster_url.clone())
        .or_else(|| result.poster_url.clone());

    sqlx::query!(
        r#"UPDATE media.tv_shows
           SET name          = COALESCE($2, name),
               overview      = $3,
               poster_path   = $4,
               genres        = $5,
               networks      = $6,
               backdrop_path = COALESCE($7, backdrop_path),
               vote_average  = COALESCE(CAST($8::float8 AS numeric(3,1)), vote_average),
               vote_count    = COALESCE($9, vote_count),
               meta_status   = 'ready',
               meta_retries  = 0,
               updated_at    = NOW()
           WHERE id = $1"#,
        show_id,
        result.title,
        result.overview,
        poster,
        &result.genres,
        &result.networks,
        candidate.as_ref().and_then(|c| c.backdrop_url.clone()),
        candidate.as_ref().and_then(|c| c.vote_average),
        candidate.as_ref().and_then(|c| c.vote_count.map(|v| v as i32)),
    )
    .execute(db)
    .await?;

    Ok(())
}

// ── Music: artists ────────────────────────────────────────────────────────────

pub async fn enrich_pending_artists(db: &PgPool, settings: &Arc<Settings>) -> Result<usize> {
    let language = load_language(db, settings).await;
    let client   = build_http_client()?;
    let mb       = MusicBrainzService::from_settings(client.clone(), &settings.metadata);
    let wikidata = WikidataService::new(client, language.clone());

    let artists = sqlx::query!(
        r#"SELECT id, name FROM media.artists
           WHERE NOT meta_locked
             AND (meta_status = 'pending_meta'
                  OR (meta_status = 'error_meta' AND meta_retries < 3
                      AND updated_at < NOW() - INTERVAL '1 hour'))
             AND name <> ''
           ORDER BY created_at DESC
           LIMIT 10"#
    )
    .fetch_all(db)
    .await?;

    let count = artists.len();

    for artist in artists {
        sqlx::query!(
            "UPDATE media.artists SET meta_status = 'fetching' WHERE id = $1",
            artist.id
        )
        .execute(db)
        .await?;

        match enrich_artist_mb(db, &mb, &wikidata, artist.id, &artist.name, None, &language).await {
            Ok(_) => tracing::info!(name = %artist.name, "Metadata artiste (MusicBrainz) OK"),
            Err(e) => {
                tracing::warn!(error = %e, name = %artist.name, "Enrichissement artiste échoué");
                sqlx::query!(
                    "UPDATE media.artists SET meta_status = 'error_meta', meta_retries = meta_retries + 1 WHERE id = $1",
                    artist.id
                )
                .execute(db)
                .await?;
            }
        }
    }

    Ok(count)
}

/// Enrich one artist from MusicBrainz + TheAudioDB (images and localized
/// biography), with Wikipedia as a biography
/// fallback. `forced_mbid` comes from the Identify flow.
#[allow(clippy::too_many_arguments)]
pub async fn enrich_artist_mb(
    db:          &PgPool,
    mb:          &MusicBrainzService,
    wikidata:    &WikidataService,
    id:          uuid::Uuid,
    name:        &str,
    forced_mbid: Option<&str>,
    language:    &str,
) -> Result<()> {
    let mbid = match forced_mbid {
        Some(m) => m.to_string(),
        None => {
            let results = mb.search_artist(name).await?;
            let want = tmdb::normalize_title(name);
            results
                .into_iter()
                // Confident match only: high search score, or exact normalized name.
                .find(|a| a.score.unwrap_or(0) >= 90 || tmdb::normalize_title(&a.name) == want)
                .ok_or_else(|| anyhow::anyhow!("Aucun match MusicBrainz sûr pour '{name}'"))?
                .id
        }
    };

    let detail = mb.get_artist(&mbid).await?;

    // TheAudioDB (by MBID): localized biography + artist image.
    let adb = theaudiodb::artist_by_mbid(&mb.client, &mbid).await;

    // Biography priority: TheAudioDB in the configured language, then the
    // Wikipedia extract (via the MusicBrainz wikidata relation), then English.
    let mut biography = adb.as_ref().and_then(|a| a.biography(language));
    if biography.is_none() {
        biography = match detail.wikidata_qid() {
            Some(qid) => wikidata.wikipedia_extract_for_qid(&qid).await.unwrap_or_default(),
            None => None,
        };
    }
    if biography.is_none() {
        biography = adb.as_ref().and_then(|a| a.biography_english());
    }

    let image = adb.as_ref().and_then(|a| a.thumb.clone()).filter(|t| !t.is_empty());

    let begin_date = detail.life_span.as_ref().and_then(|l| l.begin.as_deref()).and_then(parse_partial_date);
    let end_date   = detail.life_span.as_ref().and_then(|l| l.end.as_deref()).and_then(parse_partial_date);
    let genres = detail.top_genres(5);

    sqlx::query!(
        r#"UPDATE media.artists
           SET name        = $2,
               sort_name   = COALESCE($3, sort_name),
               artist_type = COALESCE($4, artist_type),
               country     = COALESCE($5, country),
               begin_date  = COALESCE($6, begin_date),
               end_date    = COALESCE($7, end_date),
               genres      = CASE WHEN cardinality($8::text[]) > 0 THEN $8 ELSE genres END,
               biography   = COALESCE($9, biography),
               image_path  = COALESCE($10, image_path),
               meta_status = 'ready',
               meta_retries = 0,
               updated_at  = NOW()
           WHERE id = $1"#,
        id,
        detail.name,
        detail.sort_name,
        detail.artist_type,
        detail.country,
        begin_date,
        end_date,
        &genres,
        biography,
        image,
    )
    .execute(db)
    .await?;

    // mbid is UNIQUE: the same artist in two libraries would violate it,
    // so persist best-effort in a separate statement.
    let _ = sqlx::query!(
        "UPDATE media.artists SET mbid = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM media.artists WHERE mbid = $2 AND id <> $1)",
        id, mbid
    )
    .execute(db)
    .await;

    Ok(())
}

// ── Music: albums ─────────────────────────────────────────────────────────────

pub async fn enrich_pending_albums(db: &PgPool, settings: &Arc<Settings>) -> Result<usize> {
    let client = build_http_client()?;
    let mb     = MusicBrainzService::from_settings(client, &settings.metadata);

    let albums = sqlx::query!(
        r#"SELECT a.id, a.title, ar.name AS "artist_name?"
           FROM media.albums a
           LEFT JOIN media.artists ar ON ar.id = a.artist_id
           WHERE NOT a.meta_locked
             AND (a.meta_status = 'pending_meta'
                  OR (a.meta_status = 'error_meta' AND a.meta_retries < 3
                      AND a.updated_at < NOW() - INTERVAL '1 hour'))
             AND a.title <> ''
           ORDER BY a.created_at DESC
           LIMIT 10"#
    )
    .fetch_all(db)
    .await?;

    let count = albums.len();

    for album in albums {
        sqlx::query!(
            "UPDATE media.albums SET meta_status = 'fetching' WHERE id = $1",
            album.id
        )
        .execute(db)
        .await?;

        match enrich_album_mb(db, &mb, album.id, &album.title, album.artist_name.as_deref(), None).await {
            Ok(_) => tracing::info!(title = %album.title, "Metadata album (MusicBrainz) OK"),
            Err(e) => {
                tracing::warn!(error = %e, title = %album.title, "Enrichissement album échoué");
                sqlx::query!(
                    "UPDATE media.albums SET meta_status = 'error_meta', meta_retries = meta_retries + 1 WHERE id = $1",
                    album.id
                )
                .execute(db)
                .await?;
            }
        }
    }

    Ok(count)
}

/// Enrich one album from a MusicBrainz release-group (+ Cover Art Archive
/// front cover). `forced_rgid` comes from the Identify flow.
pub async fn enrich_album_mb(
    db:          &PgPool,
    mb:          &MusicBrainzService,
    id:          uuid::Uuid,
    title:       &str,
    artist_name: Option<&str>,
    forced_rgid: Option<&str>,
) -> Result<()> {
    let rg = match forced_rgid {
        Some(rgid) => mb.get_release_group(rgid).await?,
        None => {
            let results = mb.search_release_group(title, artist_name).await?;
            let want = tmdb::normalize_title(title);
            results
                .into_iter()
                .find(|r| r.score.unwrap_or(0) >= 90 || tmdb::normalize_title(&r.title) == want)
                .ok_or_else(|| anyhow::anyhow!("Aucun release-group MusicBrainz sûr pour '{title}'"))?
        }
    };

    // Cover Art Archive front cover (404 is common — best-effort).
    let cover = mb.release_group_cover(&rg.id).await.unwrap_or_default();

    let release_year = rg.first_release_year();
    let release_date = rg
        .first_release_date
        .as_deref()
        .and_then(parse_partial_date);
    let genres = rg.top_genres(5);

    sqlx::query!(
        r#"UPDATE media.albums
           SET title        = $2,
               release_year = COALESCE($3, release_year),
               release_date = COALESCE($4, release_date),
               album_type   = COALESCE($5, album_type),
               genres       = CASE WHEN cardinality($6::text[]) > 0 THEN $6 ELSE genres END,
               -- Local artwork (module-served path) always beats remote covers.
               cover_path   = CASE WHEN cover_path LIKE '/api/%' THEN cover_path
                                   ELSE COALESCE($7, cover_path) END,
               meta_status  = 'ready',
               meta_retries = 0,
               updated_at   = NOW()
           WHERE id = $1"#,
        id,
        rg.title,
        release_year,
        release_date,
        rg.primary_type,
        &genres,
        cover,
    )
    .execute(db)
    .await?;

    let _ = sqlx::query!(
        "UPDATE media.albums SET mbid = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM media.albums WHERE mbid = $2 AND id <> $1)",
        id, rg.id
    )
    .execute(db)
    .await;

    Ok(())
}
