use axum::{
    extract::{Extension, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{errors::MediaError, middleware::auth::AuthUser, state::AppState};

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q:     String,
    pub limit: Option<i64>,
}

pub async fn search(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Value>, MediaError> {
    if q.q.trim().is_empty() {
        return Ok(Json(json!({ "movies": [], "shows": [], "artists": [], "albums": [], "tracks": [] })));
    }

    let limit = q.limit.unwrap_or(10).min(50);
    let pattern = format!("%{}%", q.q.to_lowercase());

    let movies = sqlx::query!(
        r#"SELECT id, title, release_date, poster_path
           FROM media.movies
           WHERE LOWER(title) LIKE $1
           LIMIT $2"#,
        pattern, limit
    )
    .fetch_all(&state.db)
    .await?;

    let shows = sqlx::query!(
        r#"SELECT id, name, first_air_date, poster_path
           FROM media.tv_shows
           WHERE LOWER(name) LIKE $1
           LIMIT $2"#,
        pattern, limit
    )
    .fetch_all(&state.db)
    .await?;

    let artists = sqlx::query!(
        r#"SELECT id, name, image_path
           FROM media.artists
           WHERE LOWER(name) LIKE $1
           LIMIT $2"#,
        pattern, limit
    )
    .fetch_all(&state.db)
    .await?;

    let albums = sqlx::query!(
        r#"SELECT a.id, a.title, a.release_year, a.cover_path, ar.name AS artist_name
           FROM media.albums a
           LEFT JOIN media.artists ar ON ar.id = a.artist_id
           WHERE LOWER(a.title) LIKE $1
           LIMIT $2"#,
        pattern, limit
    )
    .fetch_all(&state.db)
    .await?;

    let tracks = sqlx::query!(
        r#"SELECT t.id, t.title, t.duration_secs,
                  al.title AS album_title, al.cover_path,
                  ar.name AS artist_name
           FROM media.tracks t
           LEFT JOIN media.albums al ON al.id = t.album_id
           LEFT JOIN media.artists ar ON ar.id = t.artist_id
           WHERE LOWER(t.title) LIKE $1
           LIMIT $2"#,
        pattern, limit
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "movies": movies.iter().map(|m| json!({
            "id":           m.id,
            "title":        m.title,
            "release_date": m.release_date,
            "poster_path":  m.poster_path,
        })).collect::<Vec<_>>(),
        "shows": shows.iter().map(|s| json!({
            "id":             s.id,
            "name":           s.name,
            "first_air_date": s.first_air_date,
            "poster_path":    s.poster_path,
        })).collect::<Vec<_>>(),
        "artists": artists.iter().map(|a| json!({
            "id":         a.id,
            "name":       a.name,
            "image_path": a.image_path,
        })).collect::<Vec<_>>(),
        "albums": albums.iter().map(|a| json!({
            "id":           a.id,
            "title":        a.title,
            "release_year": a.release_year,
            "cover_path":   a.cover_path,
            "artist_name":  a.artist_name,
        })).collect::<Vec<_>>(),
        "tracks": tracks.iter().map(|t| json!({
            "id":            t.id,
            "title":         t.title,
            "duration_secs": t.duration_secs,
            "album_title":   t.album_title,
            "cover_path":    t.cover_path,
            "artist_name":   t.artist_name,
        })).collect::<Vec<_>>(),
    })))
}
