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
    models::video::ListMoviesQuery,
    state::AppState,
};

#[derive(Deserialize)]
pub struct WatchlistBody {
    pub item_type: String,
    pub item_id:   Uuid,
}

#[derive(Deserialize)]
pub struct SetPosterBody {
    pub poster_url: String,
}

pub async fn list_movies(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Query(q): Query<ListMoviesQuery>,
) -> Result<Json<Value>, MediaError> {
    let limit  = q.limit.unwrap_or(50).min(200);
    let offset = (q.page.unwrap_or(1) - 1) * limit;

    let rows = sqlx::query!(
        r#"SELECT id, title, original_title, release_date,
                  vote_average::FLOAT8, poster_path, backdrop_path,
                  duration_secs, meta_status
           FROM media.movies
           ORDER BY title
           LIMIT $1 OFFSET $2"#,
        limit,
        offset,
    )
    .fetch_all(&state.db)
    .await?;

    let movies: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":             r.id,
        "title":          r.title,
        "original_title": r.original_title,
        "release_date":   r.release_date,
        "vote_average":   r.vote_average,
        "poster_path":    r.poster_path,
        "backdrop_path":  r.backdrop_path,
        "duration_secs":  r.duration_secs,
        "meta_status":    r.meta_status,
    })).collect();

    Ok(Json(json!({ "movies": movies })))
}

pub async fn get_movie(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let row = sqlx::query!(
        r#"SELECT id, library_id, file_path, file_size, duration_secs,
                  video_codec, audio_codec, resolution_w, resolution_h,
                  tmdb_id, imdb_id, title, original_title, overview, tagline,
                  release_date, runtime_mins, poster_path, backdrop_path,
                  vote_average::FLOAT8, vote_count, popularity::FLOAT8, genres,
                  original_language, production_countries, meta_status,
                  cast_json, crew_json, subtitles, transcode_status,
                  content_rating, trailer_key, poster_urls, meta_locked, ratings_json,
                  created_at, updated_at
           FROM media.movies WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| MediaError::NotFound(format!("Film {id}")))?;

    Ok(Json(json!({
        "id":             row.id,
        "title":          row.title,
        "original_title": row.original_title,
        "overview":       row.overview,
        "tagline":        row.tagline,
        "release_date":   row.release_date,
        "runtime_mins":   row.runtime_mins,
        "poster_path":    row.poster_path,
        "backdrop_path":  row.backdrop_path,
        "vote_average":   row.vote_average,
        "vote_count":     row.vote_count,
        "genres":         row.genres,
        "duration_secs":  row.duration_secs,
        "video_codec":    row.video_codec,
        "audio_codec":    row.audio_codec,
        "resolution_w":   row.resolution_w,
        "resolution_h":   row.resolution_h,
        "subtitles":      row.subtitles,
        "cast":           row.cast_json,
        "crew":           row.crew_json,
        "meta_status":    row.meta_status,
        "content_rating": row.content_rating,
        "trailer_key":    row.trailer_key,
        "poster_urls":    row.poster_urls,
        "file_path":      row.file_path,
        "tmdb_id":        row.tmdb_id,
        "imdb_id":        row.imdb_id,
        "meta_locked":    row.meta_locked,
        "ratings":        row.ratings_json,
    })))
}

pub async fn recent_movies(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query!(
        r#"SELECT id, title, release_date, vote_average::FLOAT8, poster_path, duration_secs
           FROM media.movies
           ORDER BY created_at DESC
           LIMIT 20"#
    )
    .fetch_all(&state.db)
    .await?;

    let movies: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":           r.id,
        "title":        r.title,
        "release_date": r.release_date,
        "vote_average": r.vote_average,
        "poster_path":  r.poster_path,
        "duration_secs": r.duration_secs,
    })).collect();

    Ok(Json(json!({ "movies": movies })))
}

pub async fn continue_watching(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query!(
        r#"SELECT m.id, m.title, m.poster_path, m.backdrop_path,
                  m.duration_secs, p.position_secs, p.percent_played::FLOAT8
           FROM media.movies m
           JOIN media.video_progress p ON p.item_id = m.id AND p.item_type = 'movie'
           WHERE p.user_id = $1 AND p.is_watched = FALSE AND p.percent_played > 0
           ORDER BY p.last_played_at DESC
           LIMIT 10"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;

    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":            r.id,
        "title":         r.title,
        "poster_path":   r.poster_path,
        "backdrop_path": r.backdrop_path,
        "duration_secs": r.duration_secs,
        "position_secs": r.position_secs,
        "percent_played": r.percent_played,
        "type":          "movie",
    })).collect();

    Ok(Json(json!({ "items": items })))
}

// ── POST /movies/:id/mark-watched ────────────────────────────────────────────

pub async fn mark_watched(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let current = sqlx::query_scalar!(
        "SELECT is_watched FROM media.video_progress WHERE user_id=$1 AND item_type='movie' AND item_id=$2",
        user.id, id
    )
    .fetch_optional(&state.db)
    .await?;

    let new_watched = !current.unwrap_or(false);
    let percent: f64 = if new_watched { 100.0 } else { 0.0 };

    sqlx::query!(
        r#"INSERT INTO media.video_progress
               (user_id, item_type, item_id, position_secs, duration_secs, percent_played, is_watched)
           VALUES ($1, 'movie', $2, 0, 0, $3::NUMERIC, $4)
           ON CONFLICT (user_id, item_type, item_id) DO UPDATE
               SET is_watched     = EXCLUDED.is_watched,
                   percent_played = EXCLUDED.percent_played,
                   last_played_at = NOW()"#,
        user.id,
        id,
        percent as f64,
        new_watched,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "is_watched": new_watched })))
}

// ── POST /movies/:id/refresh-meta ────────────────────────────────────────────

pub async fn refresh_metadata(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    ensure_movie_unlocked(&state, id).await?;
    let updated = sqlx::query_scalar!(
        "UPDATE media.movies SET meta_status = 'pending_meta', meta_retries = 0 WHERE id = $1 RETURNING id",
        id
    )
    .fetch_optional(&state.db)
    .await?;

    if updated.is_none() {
        return Err(MediaError::NotFound(format!("Film {id}")));
    }

    let db2 = state.db.clone();
    let s2  = state.settings.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::workers::metadata::enrich_pending(&db2, &s2).await {
            tracing::error!(error = %e, "Erreur enrichissement métadonnées");
        }
    });

    Ok(Json(json!({ "ok": true })))
}

// ── POST /movies/:id/dissociate ───────────────────────────────────────────────

/// Reject refresh/dissociate on a metadata-locked movie.
async fn ensure_movie_unlocked(state: &AppState, id: Uuid) -> Result<(), MediaError> {
    let locked = sqlx::query_scalar!(
        "SELECT meta_locked FROM media.movies WHERE id = $1",
        id
    )
    .fetch_optional(&state.db)
    .await?;
    match locked {
        None => Err(MediaError::NotFound(format!("Film {id}"))),
        Some(true) => Err(MediaError::Conflict(
            "Métadonnées verrouillées — déverrouillez le film d'abord".into(),
        )),
        Some(false) => Ok(()),
    }
}

pub async fn dissociate(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    ensure_movie_unlocked(&state, id).await?;
    let updated = sqlx::query_scalar!(
        r#"UPDATE media.movies
           SET tmdb_id              = NULL,
               imdb_id              = NULL,
               overview             = NULL,
               tagline              = NULL,
               release_date         = NULL,
               runtime_mins         = NULL,
               poster_path          = NULL,
               backdrop_path        = NULL,
               vote_average         = NULL,
               vote_count           = NULL,
               popularity           = NULL,
               genres               = '{}',
               original_language    = NULL,
               production_countries = '{}',
               cast_json            = '[]',
               crew_json            = '[]',
               meta_status          = 'pending_meta',
               meta_retries         = 0
           WHERE id = $1
           RETURNING id"#,
        id
    )
    .fetch_optional(&state.db)
    .await?;

    if updated.is_none() {
        return Err(MediaError::NotFound(format!("Film {id}")));
    }

    Ok(Json(json!({ "ok": true })))
}

// ── GET /watchlist ────────────────────────────────────────────────────────────

pub async fn get_watchlist(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query!(
        r#"SELECT w.item_type, w.item_id, w.added_at,
                  COALESCE(m.title, s.name)               AS title,
                  COALESCE(m.poster_path, s.poster_path)  AS poster_path,
                  COALESCE(m.release_date, s.first_air_date) AS release_date
           FROM media.watchlist w
           LEFT JOIN media.movies   m ON m.id = w.item_id AND w.item_type = 'movie'
           LEFT JOIN media.tv_shows s ON s.id = w.item_id AND w.item_type = 'show'
           WHERE w.user_id = $1
           ORDER BY w.added_at DESC"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;

    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "item_type":    r.item_type,
        "item_id":      r.item_id,
        "added_at":     r.added_at,
        "title":        r.title,
        "poster_path":  r.poster_path,
        "release_date": r.release_date,
    })).collect();

    Ok(Json(json!({ "items": items })))
}

// ── POST /watchlist ───────────────────────────────────────────────────────────

pub async fn watchlist_add(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<WatchlistBody>,
) -> Result<Json<Value>, MediaError> {
    if !["movie", "show"].contains(&body.item_type.as_str()) {
        return Err(MediaError::Validation("item_type must be 'movie' or 'show'".into()));
    }

    sqlx::query!(
        r#"INSERT INTO media.watchlist (user_id, item_type, item_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, item_type, item_id) DO NOTHING"#,
        user.id,
        body.item_type,
        body.item_id,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "added": true })))
}

// ── DELETE /watchlist/:item_type/:item_id ─────────────────────────────────────

pub async fn watchlist_remove(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path((item_type, item_id)): Path<(String, Uuid)>,
) -> Result<Json<Value>, MediaError> {
    sqlx::query!(
        "DELETE FROM media.watchlist WHERE user_id=$1 AND item_type=$2 AND item_id=$3",
        user.id,
        item_type,
        item_id,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "removed": true })))
}

// ── GET /movies/:id/watchlist-status ─────────────────────────────────────────

pub async fn watchlist_status(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM media.watchlist WHERE user_id=$1 AND item_type='movie' AND item_id=$2",
        user.id, id
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    Ok(Json(json!({ "in_watchlist": count > 0 })))
}

// ── POST /movies/:id/set-poster ──────────────────────────────────────────────

pub async fn set_poster(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<SetPosterBody>,
) -> Result<Json<Value>, MediaError> {
    sqlx::query!(
        "UPDATE media.movies SET poster_path = $1, updated_at = NOW() WHERE id = $2",
        body.poster_url,
        id,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "ok": true })))
}

// ── GET /movies/:id/play-history ─────────────────────────────────────────────

pub async fn play_history(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let row = sqlx::query!(
        r#"SELECT position_secs, duration_secs, percent_played::FLOAT8,
                  is_watched, last_played_at
           FROM media.video_progress
           WHERE user_id=$1 AND item_type='movie' AND item_id=$2"#,
        user.id, id
    )
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some(r) => Ok(Json(json!({
            "has_progress":   true,
            "position_secs":  r.position_secs,
            "duration_secs":  r.duration_secs,
            "percent_played": r.percent_played,
            "is_watched":     r.is_watched,
            "last_played_at": r.last_played_at,
        }))),
        None => Ok(Json(json!({ "has_progress": false }))),
    }
}

#[derive(Deserialize)]
pub struct TrailerSearchQuery {
    pub title: String,
    pub year:  Option<i32>,
}

/// Find a movie/show trailer on YouTube without an API key by fetching the
/// public results page server-side and extracting the first video id. Returns
/// `{ "video_id": "<id>" | null }` so the client can embed it directly.
pub async fn trailer_search(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Query(q): Query<TrailerSearchQuery>,
) -> Result<Json<Value>, MediaError> {
    // Strip parenthetical/bracketed scan junk (e.g. "Hunger (film, 2008)") so the
    // query is just the bare title + year.
    let title = sanitize_title(&q.title);
    if title.is_empty() {
        return Ok(Json(json!({ "video_id": Value::Null })));
    }
    let query = match q.year {
        Some(y) => format!("{title} {y} official trailer"),
        None    => format!("{title} official trailer"),
    };

    let video_id = match state.http
        .get("https://www.youtube.com/results")
        .query(&[("search_query", query.as_str())])
        .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
    {
        Ok(resp) => extract_first_video_id(&resp.text().await.unwrap_or_default()),
        Err(e) => {
            tracing::warn!(error = %e, query = %query, "YouTube trailer search failed");
            None
        }
    };

    Ok(Json(json!({ "video_id": video_id })))
}

/// Drop parenthetical/bracketed segments and collapse whitespace.
fn sanitize_title(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    let mut depth = 0i32;
    for c in t.chars() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Extract the first `"videoId":"XXXXXXXXXXX"` (11-char) token from YouTube HTML.
fn extract_first_video_id(html: &str) -> Option<String> {
    const NEEDLE: &str = "\"videoId\":\"";
    let idx = html.find(NEEDLE)? + NEEDLE.len();
    let id: String = html[idx..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    (id.len() == 11).then_some(id)
}
