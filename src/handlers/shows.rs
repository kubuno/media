use axum::{
    extract::{Extension, Path, Query, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    models::video::ListShowsQuery,
    state::AppState,
};

pub async fn list_shows(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Query(q): Query<ListShowsQuery>,
) -> Result<Json<Value>, MediaError> {
    let limit  = q.limit.unwrap_or(50).min(200);
    let offset = (q.page.unwrap_or(1) - 1) * limit;
    let search = q.q.or(q.search).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let recent = q.sort.as_deref() == Some("recent");

    // Single query; `recent` collapses the name key so created_at wins.
    let rows = sqlx::query!(
        r#"SELECT id, name, original_name, first_air_date,
                  vote_average::FLOAT8, poster_path, backdrop_path,
                  season_count, episode_count, meta_status
           FROM media.tv_shows
           WHERE $3::text IS NULL OR name ILIKE '%' || $3 || '%'
           ORDER BY (CASE WHEN $4::bool THEN NULL ELSE name END) ASC NULLS FIRST,
                    created_at DESC
           LIMIT $1 OFFSET $2"#,
        limit,
        offset,
        search,
        recent,
    )
    .fetch_all(&state.db)
    .await?;

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
    let show = sqlx::query!(
        r#"SELECT id, library_id, name, original_name, overview, tagline,
                  first_air_date, last_air_date, status, poster_path, backdrop_path,
                  vote_average::FLOAT8, vote_count, genres, networks, season_count, episode_count,
                  original_language, cast_json, crew_json, meta_status, meta_locked,
                  ratings_json, created_at, updated_at
           FROM media.tv_shows WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| MediaError::NotFound(format!("Série {id}")))?;

    let seasons = sqlx::query!(
        r#"SELECT id, season_number, name, overview, air_date, poster_path, episode_count
           FROM media.tv_seasons WHERE show_id = $1 ORDER BY season_number"#,
        id
    )
    .fetch_all(&state.db)
    .await?;

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
    let season = sqlx::query!(
        "SELECT id FROM media.tv_seasons WHERE show_id = $1 AND season_number = $2",
        show_id, season_num
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| MediaError::NotFound(format!("Saison {season_num}")))?;

    let eps = sqlx::query!(
        r#"SELECT id, episode_number, name, overview, air_date, still_path,
                  vote_average::FLOAT8, duration_secs, meta_status, file_path
           FROM media.tv_episodes WHERE season_id = $1 ORDER BY episode_number"#,
        season.id
    )
    .fetch_all(&state.db)
    .await?;

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
