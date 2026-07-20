//! Manual identification ("Identify") + per-item metadata
//! refresh. Search endpoints return multiple candidates so the user can pick
//! the right match; apply endpoints persist the chosen external ID and
//! re-enrich from it.

use axum::{
    extract::{Extension, Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    services::{
        musicbrainz::MusicBrainzService,
        scanner::parse_video_filename,
        tmdb,
        tvmaze::{self, TvMazeService},
        wikidata::WikidataService,
    },
    state::AppState,
    workers::metadata,
};

#[derive(Deserialize)]
pub struct IdentifyQuery {
    pub query: Option<String>,
    pub year:  Option<i32>,
}

fn clean_query(q: Option<String>) -> Option<String> {
    q.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

// ── Metadata lock ─────────────────────────────────────────────────────────────

/// Reject refresh/dissociate on a locked item. `table` is compile-time
/// constant at every call site, never user input.
async fn ensure_unlocked(state: &AppState, table: &str, id: Uuid) -> Result<(), MediaError> {
    let locked: Option<bool> = sqlx::query_scalar(&format!(
        "SELECT meta_locked FROM media.{table} WHERE id = $1"
    ))
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    match locked {
        None => Err(MediaError::NotFound(format!("Élément {id}"))),
        Some(true) => Err(MediaError::Conflict(
            "Métadonnées verrouillées — déverrouillez l'élément d'abord".into(),
        )),
        Some(false) => Ok(()),
    }
}

#[derive(Deserialize)]
pub struct LockBody {
    pub locked: bool,
}

async fn set_lock(state: &AppState, table: &str, id: Uuid, locked: bool) -> Result<Json<Value>, MediaError> {
    let updated: Option<Uuid> = sqlx::query_scalar(&format!(
        "UPDATE media.{table} SET meta_locked = $2 WHERE id = $1 RETURNING id"
    ))
    .bind(id)
    .bind(locked)
    .fetch_optional(&state.db)
    .await?;
    if updated.is_none() {
        return Err(MediaError::NotFound(format!("Élément {id}")));
    }
    Ok(Json(json!({ "ok": true, "locked": locked })))
}

pub async fn lock_movie(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<LockBody>,
) -> Result<Json<Value>, MediaError> {
    set_lock(&state, "movies", id, body.locked).await
}

pub async fn lock_show(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<LockBody>,
) -> Result<Json<Value>, MediaError> {
    set_lock(&state, "tv_shows", id, body.locked).await
}

pub async fn lock_artist(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<LockBody>,
) -> Result<Json<Value>, MediaError> {
    set_lock(&state, "artists", id, body.locked).await
}

pub async fn lock_album(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<LockBody>,
) -> Result<Json<Value>, MediaError> {
    set_lock(&state, "albums", id, body.locked).await
}

// ── Movies ────────────────────────────────────────────────────────────────────

/// GET /movies/:id/identify — TMDB candidates for a manual match.
pub async fn identify_movie_search(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<IdentifyQuery>,
) -> Result<Json<Value>, MediaError> {
    let movie = sqlx::query!(
        "SELECT title, file_path FROM media.movies WHERE id = $1",
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| MediaError::NotFound(format!("Film {id}")))?;

    let filename = std::path::Path::new(&movie.file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&movie.title);
    let (parsed_title, parsed_year) = parse_video_filename(filename);
    let fallback = if parsed_title.is_empty() { movie.title.clone() } else { parsed_title };

    let query = clean_query(q.query).unwrap_or(fallback);
    let year  = q.year.or(parsed_year);

    // Providers: the official TMDB API when a key is set
    // (exhaustive, localized), else the keyless TMDB website search (popular
    // titles only) — plus Wikipedia search for lesser-known films.
    let language = metadata::load_language(&state.db, &state.settings).await;
    let tmdb_api = metadata::load_tmdb_service(&state.db, &state.settings, &state.http, &language).await;
    let wikidata = WikidataService::new(state.http.clone(), language);

    let tmdb_fut = async {
        if let Some(svc) = &tmdb_api {
            match svc.search_movie(&query, year).await {
                Ok(results) => results
                    .into_iter()
                    .take(8)
                    .map(|m| tmdb::TmdbCandidate {
                        tmdb_id:        Some(m.id as i64),
                        media_type:     "movie".to_string(),
                        title:          m.title,
                        original_title: m.original_title,
                        year:           m.release_date.as_deref().and_then(|d| d.get(..4)).and_then(|y| y.parse().ok()),
                        overview:       m.overview.filter(|o| !o.is_empty()),
                        poster_url:     m.poster_path.as_deref().map(|p| svc.poster_url(p, "w500")),
                        backdrop_url:   m.backdrop_path.as_deref().map(|p| svc.poster_url(p, "w1280")),
                        vote_average:   m.vote_average.filter(|v| *v > 0.0),
                        vote_count:     m.vote_count.filter(|v| *v > 0).map(|v| v as i64),
                    })
                    .collect(),
                Err(e) => {
                    tracing::warn!(error = %e, "Recherche TMDB API échouée, repli keyless");
                    tmdb::search_keyless(&state.http, &query, "movie").await
                }
            }
        } else {
            tmdb::search_keyless(&state.http, &query, "movie").await
        }
    };
    let (mut tmdb_cands, wiki_cands) = tokio::join!(
        tmdb_fut,
        wikidata.search_movie_candidates_wiki(&query, year, 5),
    );

    // Surface year matches first, keep TMDB relevance order otherwise.
    if let Some(y) = year {
        tmdb_cands.sort_by_key(|c| if c.year == Some(y) { 0 } else { 1 });
    }

    let mut candidates: Vec<Value> = Vec::new();
    let mut seen: Vec<(String, Option<i32>)> = Vec::new();
    for c in &tmdb_cands {
        seen.push((tmdb::normalize_title(&c.title), c.year));
        let mut v = serde_json::to_value(c).unwrap_or_default();
        v["source"] = json!("tmdb");
        candidates.push(v);
    }
    for w in wiki_cands.unwrap_or_default() {
        let key = (tmdb::normalize_title(&w.title), w.year);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        candidates.push(json!({
            "tmdb_id":        null,
            "media_type":     "movie",
            "title":          w.title,
            "original_title": null,
            "year":           w.year,
            "overview":       w.overview,
            "poster_url":     w.poster_url,
            "backdrop_url":   null,
            "vote_average":   null,
            "vote_count":     null,
            "source":         "wikipedia",
        }));
    }

    Ok(Json(json!({ "query": query, "year": year, "candidates": candidates })))
}

/// POST /movies/:id/identify — apply a chosen TMDB candidate.
pub async fn identify_movie_apply(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(candidate): Json<tmdb::TmdbCandidate>,
) -> Result<Json<Value>, MediaError> {
    let exists = sqlx::query_scalar!("SELECT id FROM media.movies WHERE id = $1", id)
        .fetch_optional(&state.db)
        .await?;
    if exists.is_none() {
        return Err(MediaError::NotFound(format!("Film {id}")));
    }
    if candidate.title.trim().is_empty() {
        return Err(MediaError::Validation("Titre du candidat manquant".into()));
    }

    metadata::apply_movie_candidate(&state.db, &state.settings, id, &candidate)
        .await
        .map_err(MediaError::Internal)?;

    Ok(Json(json!({ "ok": true })))
}

// ── TV shows ──────────────────────────────────────────────────────────────────

/// GET /shows/:id/identify — TVMaze candidates for a manual match.
pub async fn identify_show_search(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<IdentifyQuery>,
) -> Result<Json<Value>, MediaError> {
    let show = sqlx::query!("SELECT name FROM media.tv_shows WHERE id = $1", id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| MediaError::NotFound(format!("Série {id}")))?;

    let query = clean_query(q.query).unwrap_or(show.name);
    let tvmaze = TvMazeService::new(state.http.clone());
    let results = tvmaze
        .search_show(&query)
        .await
        .map_err(|e| MediaError::Upstream(format!("TVMaze: {e}")))?;

    let candidates: Vec<Value> = results
        .into_iter()
        .map(|r| {
            let year = r.show.premiered
                .as_deref()
                .and_then(|d| d.get(..4))
                .and_then(|y| y.parse::<i32>().ok());
            json!({
                "tvmaze_id":  r.show.id,
                "name":       r.show.name,
                "year":       year,
                "status":     r.show.status,
                "network":    r.show.network.map(|n| n.name),
                "genres":     r.show.genres,
                "overview":   r.show.summary.as_deref().map(tvmaze::strip_html),
                "poster_url": r.show.image.and_then(|i| i.original.or(i.medium)),
                "score":      r.score,
            })
        })
        .collect();

    Ok(Json(json!({ "query": query, "candidates": candidates })))
}

#[derive(Deserialize)]
pub struct ShowApplyBody {
    pub tvmaze_id: i32,
}

/// POST /shows/:id/identify — apply a chosen TVMaze candidate (fetch by ID).
pub async fn identify_show_apply(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<ShowApplyBody>,
) -> Result<Json<Value>, MediaError> {
    let show = sqlx::query!("SELECT name FROM media.tv_shows WHERE id = $1", id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| MediaError::NotFound(format!("Série {id}")))?;

    sqlx::query!(
        "UPDATE media.tv_shows SET meta_status = 'fetching', meta_retries = 0 WHERE id = $1",
        id
    )
    .execute(&state.db)
    .await?;

    let tvmaze = TvMazeService::new(state.http.clone());
    if let Err(e) = metadata::enrich_show_tvmaze(
        &state.db, &state.http, &tvmaze, id, &show.name, Some(body.tvmaze_id),
    )
    .await
    {
        sqlx::query!(
            "UPDATE media.tv_shows SET meta_status = 'error_meta' WHERE id = $1",
            id
        )
        .execute(&state.db)
        .await?;
        return Err(MediaError::Upstream(format!("TVMaze: {e}")));
    }

    Ok(Json(json!({ "ok": true })))
}

/// POST /shows/:id/refresh-meta — re-enrich (by stored tvmaze_id when present).
pub async fn refresh_show(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    ensure_unlocked(&state, "tv_shows", id).await?;
    let updated = sqlx::query_scalar!(
        "UPDATE media.tv_shows SET meta_status = 'pending_meta', meta_retries = 0 WHERE id = $1 RETURNING id",
        id
    )
    .fetch_optional(&state.db)
    .await?;
    if updated.is_none() {
        return Err(MediaError::NotFound(format!("Série {id}")));
    }

    let db2 = state.db.clone();
    let s2  = state.settings.clone();
    tokio::spawn(async move {
        if let Err(e) = metadata::enrich_pending_shows(&db2, &s2).await {
            tracing::error!(error = %e, "Erreur refresh série");
        }
    });

    Ok(Json(json!({ "ok": true })))
}

// ── Artists ───────────────────────────────────────────────────────────────────

/// GET /artists/:id/identify — MusicBrainz artist candidates.
pub async fn identify_artist_search(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<IdentifyQuery>,
) -> Result<Json<Value>, MediaError> {
    let artist = sqlx::query!("SELECT name FROM media.artists WHERE id = $1", id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| MediaError::NotFound(format!("Artiste {id}")))?;

    let query = clean_query(q.query).unwrap_or(artist.name);
    let mb = MusicBrainzService::from_settings(state.http.clone(), &state.settings.metadata);
    let mut results = mb
        .search_artist(&query)
        .await
        .map_err(|e| MediaError::Upstream(format!("MusicBrainz: {e}")))?;
    // Composite "featuring"-style names from path parsing ("Black M/Zaho")
    // don't exist in MusicBrainz — retry with the first segment.
    if results.is_empty() {
        if let Some(first) = query.split(['/', ',', ';']).next().map(str::trim) {
            if !first.is_empty() && first != query {
                results = mb.search_artist(first).await.unwrap_or_default();
            }
        }
    }

    let candidates: Vec<Value> = results
        .into_iter()
        .map(|a| json!({
            "mbid":           a.id,
            "name":           a.name,
            "disambiguation": a.disambiguation,
            "type":           a.artist_type,
            "country":        a.country,
            "begin":          a.life_span.as_ref().and_then(|l| l.begin.clone()),
            "score":          a.score,
        }))
        .collect();

    Ok(Json(json!({ "query": query, "candidates": candidates })))
}

#[derive(Deserialize)]
pub struct MbApplyBody {
    pub mbid: String,
}

/// POST /artists/:id/identify — apply a chosen MusicBrainz artist.
pub async fn identify_artist_apply(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<MbApplyBody>,
) -> Result<Json<Value>, MediaError> {
    let artist = sqlx::query!("SELECT name FROM media.artists WHERE id = $1", id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| MediaError::NotFound(format!("Artiste {id}")))?;

    sqlx::query!(
        "UPDATE media.artists SET meta_status = 'fetching', meta_retries = 0 WHERE id = $1",
        id
    )
    .execute(&state.db)
    .await?;

    let language = metadata::load_language(&state.db, &state.settings).await;
    let mb = MusicBrainzService::from_settings(state.http.clone(), &state.settings.metadata);
    let wikidata = WikidataService::new(state.http.clone(), language.clone());

    if let Err(e) = metadata::enrich_artist_mb(
        &state.db, &mb, &wikidata, id, &artist.name, Some(&body.mbid), &language,
    )
    .await
    {
        sqlx::query!(
            "UPDATE media.artists SET meta_status = 'error_meta' WHERE id = $1",
            id
        )
        .execute(&state.db)
        .await?;
        return Err(MediaError::Upstream(format!("MusicBrainz: {e}")));
    }

    Ok(Json(json!({ "ok": true })))
}

/// POST /artists/:id/refresh-meta
pub async fn refresh_artist(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    ensure_unlocked(&state, "artists", id).await?;
    let updated = sqlx::query_scalar!(
        "UPDATE media.artists SET meta_status = 'pending_meta', meta_retries = 0 WHERE id = $1 RETURNING id",
        id
    )
    .fetch_optional(&state.db)
    .await?;
    if updated.is_none() {
        return Err(MediaError::NotFound(format!("Artiste {id}")));
    }

    let db2 = state.db.clone();
    let s2  = state.settings.clone();
    tokio::spawn(async move {
        if let Err(e) = metadata::enrich_pending_artists(&db2, &s2).await {
            tracing::error!(error = %e, "Erreur refresh artiste");
        }
    });

    Ok(Json(json!({ "ok": true })))
}

// ── Albums ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AlbumIdentifyQuery {
    pub query:  Option<String>,
    pub artist: Option<String>,
}

/// GET /albums/:id/identify — MusicBrainz release-group candidates.
pub async fn identify_album_search(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<AlbumIdentifyQuery>,
) -> Result<Json<Value>, MediaError> {
    let album = sqlx::query!(
        r#"SELECT a.title, ar.name AS "artist_name?"
           FROM media.albums a
           LEFT JOIN media.artists ar ON ar.id = a.artist_id
           WHERE a.id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| MediaError::NotFound(format!("Album {id}")))?;

    let query  = clean_query(q.query).unwrap_or(album.title);
    let artist = clean_query(q.artist).or(album.artist_name);

    let mb = MusicBrainzService::from_settings(state.http.clone(), &state.settings.metadata);
    let mut results = mb
        .search_release_group(&query, artist.as_deref())
        .await
        .map_err(|e| MediaError::Upstream(format!("MusicBrainz: {e}")))?;
    // Composite artist names ("Black M/Zaho") over-constrain the search:
    // retry with each name segment, then without any artist scope.
    if results.is_empty() {
        if let Some(ref a) = artist {
            for segment in a.split(['/', ',', ';']).map(str::trim).filter(|s| !s.is_empty() && *s != a) {
                results = mb.search_release_group(&query, Some(segment)).await.unwrap_or_default();
                if !results.is_empty() {
                    break;
                }
            }
        }
        if results.is_empty() {
            results = mb.search_release_group(&query, None).await.unwrap_or_default();
        }
    }

    let candidates: Vec<Value> = results
        .into_iter()
        .map(|r| json!({
            "mbid":   r.id,
            "title":  r.title,
            "artist": r.artist_name(),
            "year":   r.first_release_year(),
            "type":   r.primary_type,
            "score":  r.score,
        }))
        .collect();

    Ok(Json(json!({ "query": query, "artist": artist, "candidates": candidates })))
}

/// POST /albums/:id/identify — apply a chosen MusicBrainz release-group.
pub async fn identify_album_apply(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<MbApplyBody>,
) -> Result<Json<Value>, MediaError> {
    let album = sqlx::query!(
        r#"SELECT a.title, ar.name AS "artist_name?"
           FROM media.albums a
           LEFT JOIN media.artists ar ON ar.id = a.artist_id
           WHERE a.id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| MediaError::NotFound(format!("Album {id}")))?;

    sqlx::query!(
        "UPDATE media.albums SET meta_status = 'fetching', meta_retries = 0 WHERE id = $1",
        id
    )
    .execute(&state.db)
    .await?;

    let mb = MusicBrainzService::from_settings(state.http.clone(), &state.settings.metadata);
    if let Err(e) = metadata::enrich_album_mb(
        &state.db, &mb, id, &album.title, album.artist_name.as_deref(), Some(&body.mbid),
    )
    .await
    {
        sqlx::query!(
            "UPDATE media.albums SET meta_status = 'error_meta' WHERE id = $1",
            id
        )
        .execute(&state.db)
        .await?;
        return Err(MediaError::Upstream(format!("MusicBrainz: {e}")));
    }

    Ok(Json(json!({ "ok": true })))
}

/// POST /albums/:id/refresh-meta
pub async fn refresh_album(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    ensure_unlocked(&state, "albums", id).await?;
    let updated = sqlx::query_scalar!(
        "UPDATE media.albums SET meta_status = 'pending_meta', meta_retries = 0 WHERE id = $1 RETURNING id",
        id
    )
    .fetch_optional(&state.db)
    .await?;
    if updated.is_none() {
        return Err(MediaError::NotFound(format!("Album {id}")));
    }

    let db2 = state.db.clone();
    let s2  = state.settings.clone();
    tokio::spawn(async move {
        if let Err(e) = metadata::enrich_pending_albums(&db2, &s2).await {
            tracing::error!(error = %e, "Erreur refresh album");
        }
    });

    Ok(Json(json!({ "ok": true })))
}
