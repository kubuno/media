use axum::{
    extract::{Extension, Path, Query, State},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use kubuno_db::{
    dialect::{Assign, SqlType},
    params,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::types::JsonValue;
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    models::video::ListMoviesQuery,
    services::parental,
    state::AppState,
};

/// Drops the movies the instance's age limit hides from this user.
///
/// Filtering happens in RUST, on rows already deserialised, because the list
/// queries must stay portable across the three engines and must not gain a
/// per-engine WHERE clause. Two consequences, accepted knowingly:
///   * a paginated page can come back SHORTER than its limit — the client shows
///     fewer cards, it never shows a forbidden one;
///   * this is a display filter only. The HARD gate is in `handlers::stream`,
///     which is what actually refuses to serve the bytes.
///
/// Administrators are never filtered: they must see what they configured.
/// `ids` are the movie ids of the rows, in order; the returned set is the ids
/// that may be shown.
async fn visible_movie_ids(
    state: &AppState,
    user: &AuthUser,
    ids: &[Uuid],
) -> Option<std::collections::HashSet<Uuid>> {
    let cfg = state.instance();
    if !cfg.parental_active() || user.role == "admin" {
        return None; // nothing to filter
    }
    let ratings = parental::ratings_for(&state.db, ids).await;
    Some(
        ids.iter()
            .copied()
            .filter(|id| {
                let rating = ratings.get(id).and_then(|r| r.as_deref());
                parental::is_allowed(rating, cfg.max_content_age, cfg.block_unrated_content)
            })
            .collect(),
    )
}

#[derive(Deserialize)]
pub struct WatchlistBody {
    pub item_type: String,
    pub item_id:   Uuid,
}

#[derive(Deserialize)]
pub struct SetPosterBody {
    pub poster_url: String,
}

// Row shapes for the runtime queries (one binary, three engines: kubuno-db).
#[derive(sqlx::FromRow)]
struct MovieListRow {
    id:              Uuid,
    title:           String,
    original_title:  Option<String>,
    release_date:    Option<NaiveDate>,
    vote_average:    Option<f64>,
    poster_path:     Option<String>,
    backdrop_path:   Option<String>,
    duration_secs:   i32,
    meta_status:     String,
}

pub async fn list_movies(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Query(q): Query<ListMoviesQuery>,
) -> Result<Json<Value>, MediaError> {
    let limit  = q.limit.unwrap_or(50).min(200);
    let offset = (q.page.unwrap_or(1) - 1) * limit;

    // `vote_average` is NUMERIC: cast it to a portably-decodable DOUBLE per engine.
    let vote_avg = state.db.backend().cast("vote_average", SqlType::Double);
    let sql = format!(
        r#"SELECT id, title, original_title, release_date,
                  {vote_avg} AS vote_average, poster_path, backdrop_path,
                  duration_secs, meta_status
           FROM media.movies
           ORDER BY title
           LIMIT $1 OFFSET $2"#
    );
    let rows = state.db.fetch_all_as::<MovieListRow>(&sql, params![limit, offset]).await?;

    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let visible = visible_movie_ids(&state, &user, &ids).await;

    let movies: Vec<Value> = rows.into_iter()
        .filter(|r| match &visible { Some(v) => v.contains(&r.id), None => true })
        .map(|r| json!({
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

#[derive(sqlx::FromRow)]
#[allow(dead_code)] // over-selects (SELECT *); not every column feeds the JSON response
struct MovieDetailRow {
    id:                   Uuid,
    library_id:           Uuid,
    file_path:            String,
    file_size:            i64,
    duration_secs:        i32,
    video_codec:          Option<String>,
    audio_codec:          Option<String>,
    resolution_w:         Option<i32>,
    resolution_h:         Option<i32>,
    tmdb_id:              Option<i32>,
    imdb_id:              Option<String>,
    title:                String,
    original_title:       Option<String>,
    overview:             Option<String>,
    tagline:              Option<String>,
    release_date:         Option<NaiveDate>,
    runtime_mins:         Option<i32>,
    poster_path:          Option<String>,
    backdrop_path:        Option<String>,
    vote_average:         Option<f64>,
    vote_count:           Option<i32>,
    popularity:           Option<f64>,
    #[sqlx(json)]
    genres:               Vec<String>,
    original_language:    Option<String>,
    #[sqlx(json)]
    production_countries: Vec<String>,
    meta_status:          String,
    cast_json:            JsonValue,
    crew_json:            JsonValue,
    subtitles:            JsonValue,
    transcode_status:     JsonValue,
    content_rating:       Option<String>,
    trailer_key:          Option<String>,
    #[sqlx(json)]
    poster_urls:          Vec<String>,
    meta_locked:          bool,
    ratings_json:         JsonValue,
    #[allow(dead_code)]
    created_at:           DateTime<Utc>,
    #[allow(dead_code)]
    updated_at:           DateTime<Utc>,
}

pub async fn get_movie(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    // `vote_average`/`popularity` are NUMERIC: cast to a portably-decodable
    // DOUBLE per engine.
    let vote_avg    = state.db.backend().cast("vote_average", SqlType::Double);
    let popularity  = state.db.backend().cast("popularity", SqlType::Double);
    let sql = format!(
        r#"SELECT id, library_id, file_path, file_size, duration_secs,
                  video_codec, audio_codec, resolution_w, resolution_h,
                  tmdb_id, imdb_id, title, original_title, overview, tagline,
                  release_date, runtime_mins, poster_path, backdrop_path,
                  {vote_avg} AS vote_average, vote_count, {popularity} AS popularity, genres,
                  original_language, production_countries, meta_status,
                  cast_json, crew_json, subtitles, transcode_status,
                  content_rating, trailer_key, poster_urls, meta_locked, ratings_json,
                  created_at, updated_at
           FROM media.movies WHERE id = $1"#
    );
    let row = state.db.fetch_optional_as::<MovieDetailRow>(&sql, params![id])
        .await?
        .ok_or_else(|| MediaError::NotFound(format!("Film {id}")))?;

    // The detail page already carries the certification, so the age limit is
    // applied without a second query. Refused outright rather than trimmed: the
    // sheet is what leads to playback.
    {
        let cfg = state.instance();
        if cfg.parental_active()
            && user.role != "admin"
            && !parental::is_allowed(
                row.content_rating.as_deref(),
                cfg.max_content_age,
                cfg.block_unrated_content,
            )
        {
            return Err(MediaError::Forbidden);
        }
    }

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

#[derive(sqlx::FromRow)]
struct MovieRecentRow {
    id:            Uuid,
    title:         String,
    release_date:  Option<NaiveDate>,
    vote_average:  Option<f64>,
    poster_path:   Option<String>,
    duration_secs: i32,
}

pub async fn recent_movies(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let vote_avg = state.db.backend().cast("vote_average", SqlType::Double);
    let sql = format!(
        r#"SELECT id, title, release_date, {vote_avg} AS vote_average, poster_path, duration_secs
           FROM media.movies
           ORDER BY created_at DESC
           LIMIT 20"#
    );
    let rows = state.db.fetch_all_as::<MovieRecentRow>(&sql, params![]).await?;

    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let visible = visible_movie_ids(&state, &user, &ids).await;

    let movies: Vec<Value> = rows.into_iter()
        .filter(|r| match &visible { Some(v) => v.contains(&r.id), None => true })
        .map(|r| json!({
            "id":           r.id,
            "title":        r.title,
            "release_date": r.release_date,
            "vote_average": r.vote_average,
            "poster_path":  r.poster_path,
            "duration_secs": r.duration_secs,
        })).collect();

    Ok(Json(json!({ "movies": movies })))
}

#[derive(sqlx::FromRow)]
struct ContinueWatchingRow {
    id:              Uuid,
    title:           String,
    poster_path:     Option<String>,
    backdrop_path:   Option<String>,
    duration_secs:   i32,
    position_secs:   i32,
    percent_played:  f64,
}

pub async fn continue_watching(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let percent_played = state.db.backend().cast("p.percent_played", SqlType::Double);
    let sql = format!(
        r#"SELECT m.id, m.title, m.poster_path, m.backdrop_path,
                  m.duration_secs, p.position_secs, {percent_played} AS percent_played
           FROM media.movies m
           JOIN media.video_progress p ON p.item_id = m.id AND p.item_type = 'movie'
           WHERE p.user_id = $1 AND p.is_watched = FALSE AND p.percent_played > 0
           ORDER BY p.last_played_at DESC
           LIMIT 10"#
    );
    let rows = state.db.fetch_all_as::<ContinueWatchingRow>(&sql, params![user.id]).await?;

    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let visible = visible_movie_ids(&state, &user, &ids).await;

    let items: Vec<Value> = rows.into_iter()
        .filter(|r| match &visible { Some(v) => v.contains(&r.id), None => true })
        .map(|r| json!({
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
    let current = state.db.fetch_optional_scalar::<bool>(
        "SELECT is_watched FROM media.video_progress WHERE user_id=$1 AND item_type='movie' AND item_id=$2",
        params![user.id, id],
    ).await?;

    let new_watched = !current.unwrap_or(false);
    let percent: f64 = if new_watched { 100.0 } else { 0.0 };
    let now = Utc::now();

    // `last_played_at` is bound as a Rust timestamp (never `NOW()` in SQL) so
    // the insert and the update branch agree on the exact same instant.
    let clause = state.db.backend().upsert(
        "media.video_progress",
        &["user_id", "item_type", "item_id"],
        &[
            Assign::Incoming("is_watched"),
            Assign::Incoming("percent_played"),
            Assign::Incoming("last_played_at"),
        ],
    );
    let sql = format!(
        r#"INSERT INTO media.video_progress
               (user_id, item_type, item_id, position_secs, duration_secs, percent_played, is_watched, last_played_at)
           VALUES ($1, 'movie', $2, 0, 0, $3, $4, $5){clause}"#
    );
    state.db.execute(&sql, params![user.id, id, percent, new_watched, now]).await?;

    Ok(Json(json!({ "is_watched": new_watched })))
}

// ── POST /movies/:id/refresh-meta ────────────────────────────────────────────

pub async fn refresh_metadata(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    ensure_movie_unlocked(&state, id).await?;
    // No `RETURNING` (MySQL/SQLite don't have it on UPDATE): the number of
    // affected rows tells us whether the movie existed.
    let affected = state.db.execute(
        "UPDATE media.movies SET meta_status = 'pending_meta', meta_retries = 0 WHERE id = $1",
        params![id],
    ).await?;

    if affected == 0 {
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
    let locked = state.db.fetch_optional_scalar::<bool>(
        "SELECT meta_locked FROM media.movies WHERE id = $1",
        params![id],
    ).await?;
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
    // `genres`/`production_countries` are JSON columns now: an empty Vec<String>
    // binds as the JSON array `[]`, the equivalent of the old `'{}'` PG array
    // literal. `cast_json`/`crew_json` are plain JSON columns: bind `[]` directly.
    let empty_strings: Vec<String> = Vec::new();
    let affected = state.db.execute(
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
               genres               = $1,
               original_language    = NULL,
               production_countries = $2,
               cast_json            = $3,
               crew_json            = $4,
               meta_status          = 'pending_meta',
               meta_retries         = 0
           WHERE id = $5"#,
        params![empty_strings.clone(), empty_strings, json!([]), json!([]), id],
    ).await?;

    if affected == 0 {
        return Err(MediaError::NotFound(format!("Film {id}")));
    }

    Ok(Json(json!({ "ok": true })))
}

// ── GET /watchlist ────────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct WatchlistRow {
    item_type:     String,
    item_id:       Uuid,
    added_at:      DateTime<Utc>,
    title:         Option<String>,
    poster_path:   Option<String>,
    release_date:  Option<NaiveDate>,
}

pub async fn get_watchlist(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = state.db.fetch_all_as::<WatchlistRow>(
        r#"SELECT w.item_type, w.item_id, w.added_at,
                  COALESCE(m.title, s.name)               AS title,
                  COALESCE(m.poster_path, s.poster_path)  AS poster_path,
                  COALESCE(m.release_date, s.first_air_date) AS release_date
           FROM media.watchlist w
           LEFT JOIN media.movies   m ON m.id = w.item_id AND w.item_type = 'movie'
           LEFT JOIN media.tv_shows s ON s.id = w.item_id AND w.item_type = 'show'
           WHERE w.user_id = $1
           ORDER BY w.added_at DESC"#,
        params![user.id],
    ).await?;

    // Only the movie entries carry a certification; show entries pass through.
    let ids: Vec<Uuid> = rows.iter()
        .filter(|r| r.item_type == "movie")
        .map(|r| r.item_id)
        .collect();
    let visible = visible_movie_ids(&state, &user, &ids).await;

    let items: Vec<Value> = rows.into_iter()
        .filter(|r| match &visible {
            Some(v) => r.item_type != "movie" || v.contains(&r.item_id),
            None    => true,
        })
        .map(|r| json!({
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

    let sql = format!(
        "INSERT {}INTO media.watchlist (user_id, item_type, item_id) VALUES ($1, $2, $3){}",
        state.db.backend().insert_ignore_prefix(),
        state.db.backend().on_conflict_do_nothing(&["user_id", "item_type", "item_id"]),
    );
    state.db.execute(&sql, params![user.id, body.item_type, body.item_id]).await?;

    Ok(Json(json!({ "added": true })))
}

// ── DELETE /watchlist/:item_type/:item_id ─────────────────────────────────────

pub async fn watchlist_remove(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path((item_type, item_id)): Path<(String, Uuid)>,
) -> Result<Json<Value>, MediaError> {
    state.db.execute(
        "DELETE FROM media.watchlist WHERE user_id=$1 AND item_type=$2 AND item_id=$3",
        params![user.id, item_type, item_id],
    ).await?;

    Ok(Json(json!({ "removed": true })))
}

// ── GET /movies/:id/watchlist-status ─────────────────────────────────────────

pub async fn watchlist_status(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let sql = format!(
        "SELECT {} FROM media.watchlist WHERE user_id=$1 AND item_type='movie' AND item_id=$2",
        state.db.backend().count_bigint("*"),
    );
    let count: i64 = state.db.fetch_scalar(&sql, params![user.id, id]).await?;

    Ok(Json(json!({ "in_watchlist": count > 0 })))
}

// ── POST /movies/:id/set-poster ──────────────────────────────────────────────

pub async fn set_poster(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<SetPosterBody>,
) -> Result<Json<Value>, MediaError> {
    // `updated_at` is maintained by the engine's trigger/ON UPDATE clause, not set here.
    state.db.execute(
        "UPDATE media.movies SET poster_path = $1 WHERE id = $2",
        params![body.poster_url, id],
    ).await?;

    Ok(Json(json!({ "ok": true })))
}

// ── GET /movies/:id/play-history ─────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct PlayHistoryRow {
    position_secs:   i32,
    duration_secs:   i32,
    percent_played:  f64,
    is_watched:      bool,
    last_played_at:  DateTime<Utc>,
}

pub async fn play_history(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let percent_played = state.db.backend().cast("percent_played", SqlType::Double);
    let sql = format!(
        r#"SELECT position_secs, duration_secs, {percent_played} AS percent_played,
                  is_watched, last_played_at
           FROM media.video_progress
           WHERE user_id=$1 AND item_type='movie' AND item_id=$2"#
    );
    let row = state.db.fetch_optional_as::<PlayHistoryRow>(&sql, params![user.id, id]).await?;

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
