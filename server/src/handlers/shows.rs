use axum::{
    extract::{Extension, Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use kubuno_db::params;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    models::video::ListShowsQuery,
    state::AppState,
};

// Row shapes for the runtime queries (one binary, three engines: kubuno-db).
#[derive(sqlx::FromRow)]
struct ShowListRow {
    id:              Uuid,
    name:            String,
    original_name:   Option<String>,
    first_air_date:  Option<NaiveDate>,
    vote_average:    Option<f64>,
    poster_path:     Option<String>,
    backdrop_path:   Option<String>,
    season_count:    i32,
    episode_count:   i32,
    meta_status:     String,
}

#[derive(sqlx::FromRow)]
struct ShowDetailRow {
    id:                 Uuid,
    name:               String,
    original_name:      Option<String>,
    overview:           Option<String>,
    tagline:            Option<String>,
    first_air_date:     Option<NaiveDate>,
    last_air_date:      Option<NaiveDate>,
    status:             Option<String>,
    poster_path:        Option<String>,
    backdrop_path:      Option<String>,
    vote_average:       Option<f64>,
    vote_count:         Option<i32>,
    #[sqlx(json)]
    genres:             Vec<String>,
    #[sqlx(json)]
    networks:           Vec<String>,
    season_count:       i32,
    episode_count:      i32,
    original_language:  Option<String>,
    #[sqlx(json)]
    cast_json:          Value,
    meta_status:        String,
    meta_locked:        bool,
    #[sqlx(json)]
    ratings_json:       Value,
}

#[derive(sqlx::FromRow)]
struct SeasonRow {
    id:            Uuid,
    season_number: i32,
    name:          Option<String>,
    air_date:      Option<NaiveDate>,
    poster_path:   Option<String>,
    episode_count: i32,
}

#[derive(sqlx::FromRow)]
struct SeasonIdRow {
    id: Uuid,
}

#[derive(sqlx::FromRow)]
#[allow(dead_code)] // over-selects; meta_status decoded but unused here
struct EpisodeRow {
    id:              Uuid,
    episode_number:  i32,
    name:            Option<String>,
    overview:        Option<String>,
    air_date:        Option<NaiveDate>,
    still_path:      Option<String>,
    vote_average:    Option<f64>,
    duration_secs:   Option<i32>,
    meta_status:     String,
    file_path:       Option<String>,
}

pub async fn list_shows(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Query(q): Query<ListShowsQuery>,
) -> Result<Json<Value>, MediaError> {
    let limit  = q.limit.unwrap_or(50).min(200);
    let offset = (q.page.unwrap_or(1) - 1) * limit;
    let search = q.q.or(q.search).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let recent = q.sort.as_deref() == Some("recent");

    // `%` alone matches every row, so a single query text covers both the
    // filtered and unfiltered cases (no `$n::text IS NULL OR ...` needed).
    let pattern = match &search {
        Some(s) => format!("%{}%", s.to_lowercase()),
        None => "%".to_string(),
    };
    // `recent` collapses the name key so created_at wins; chosen in Rust
    // instead of a `CASE WHEN $n::bool` to avoid a portability cast.
    let order_by = if recent { "created_at DESC" } else { "name ASC, created_at DESC" };

    let sql = format!(
        r#"SELECT id, name, original_name, first_air_date,
                  vote_average, poster_path, backdrop_path,
                  season_count, episode_count, meta_status
           FROM media.tv_shows
           WHERE LOWER(name) LIKE $1
           ORDER BY {order_by}
           LIMIT $2 OFFSET $3"#
    );

    let rows = state.db.fetch_all_as::<ShowListRow>(
        &sql,
        params![pattern, limit, offset],
    ).await?;

    let shows: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":            r.id,
        "name":          r.name,
        "original_name": r.original_name,
        "first_air_date": r.first_air_date,
        "vote_average":  r.vote_average,
        "poster_path":   r.poster_path,
        "backdrop_path": r.backdrop_path,
        "season_count":  r.season_count,
        "episode_count": r.episode_count,
        "meta_status":   r.meta_status,
    })).collect();

    Ok(Json(json!({ "shows": shows })))
}

pub async fn get_show(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let show = state.db.fetch_optional_as::<ShowDetailRow>(
        r#"SELECT id, library_id, name, original_name, overview, tagline,
                  first_air_date, last_air_date, status, poster_path, backdrop_path,
                  vote_average, vote_count, genres, networks, season_count, episode_count,
                  original_language, cast_json, crew_json, meta_status, meta_locked,
                  ratings_json, created_at, updated_at
           FROM media.tv_shows WHERE id = $1"#,
        params![id],
    ).await?
    .ok_or_else(|| MediaError::NotFound(format!("Série {id}")))?;

    let seasons = state.db.fetch_all_as::<SeasonRow>(
        r#"SELECT id, season_number, name, overview, air_date, poster_path, episode_count
           FROM media.tv_seasons WHERE show_id = $1 ORDER BY season_number"#,
        params![id],
    ).await?;

    Ok(Json(json!({
        "id":               show.id,
        "name":             show.name,
        "original_name":    show.original_name,
        "overview":         show.overview,
        "tagline":          show.tagline,
        "poster_path":      show.poster_path,
        "backdrop_path":    show.backdrop_path,
        "vote_average":     show.vote_average,
        "vote_count":       show.vote_count,
        "genres":           show.genres,
        "networks":         show.networks,
        "status":           show.status,
        "first_air_date":   show.first_air_date,
        "last_air_date":    show.last_air_date,
        "original_language": show.original_language,
        "season_count":     show.season_count,
        "episode_count":    show.episode_count,
        "meta_status":      show.meta_status,
        "meta_locked":      show.meta_locked,
        "ratings":          show.ratings_json,
        "cast":             show.cast_json,
        "seasons":          seasons.iter().map(|s| json!({
            "id":             s.id,
            "season_number":  s.season_number,
            "name":           s.name,
            "air_date":       s.air_date,
            "poster_path":    s.poster_path,
            "episode_count":  s.episode_count,
        })).collect::<Vec<_>>(),
    })))
}

pub async fn get_season_episodes(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path((show_id, season_num)): Path<(Uuid, i32)>,
) -> Result<Json<Value>, MediaError> {
    let season = state.db.fetch_optional_as::<SeasonIdRow>(
        "SELECT id FROM media.tv_seasons WHERE show_id = $1 AND season_number = $2",
        params![show_id, season_num],
    ).await?
    .ok_or_else(|| MediaError::NotFound(format!("Saison {season_num}")))?;

    let eps = state.db.fetch_all_as::<EpisodeRow>(
        r#"SELECT id, episode_number, name, overview, air_date, still_path,
                  vote_average, duration_secs, meta_status, file_path
           FROM media.tv_episodes WHERE season_id = $1 ORDER BY episode_number"#,
        params![season.id],
    ).await?;

    let episodes: Vec<Value> = eps.into_iter().map(|e| json!({
        "id":             e.id,
        "episode_number": e.episode_number,
        "name":           e.name,
        "overview":       e.overview,
        "air_date":       e.air_date,
        "still_path":     e.still_path,
        "vote_average":   e.vote_average,
        "duration_secs":  e.duration_secs,
        "has_file":       e.file_path.is_some(),
    })).collect();

    Ok(Json(json!({ "episodes": episodes })))
}
