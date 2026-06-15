use axum::{
    extract::{Extension, Path, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{errors::MediaError, middleware::auth::AuthUser, state::AppState};

pub async fn list_artists(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query!(
        r#"SELECT id, name, sort_name, image_path, genres, album_count, track_count
           FROM media.artists ORDER BY COALESCE(sort_name, name)"#
    )
    .fetch_all(&state.db)
    .await?;

    let artists: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":          r.id,
        "name":        r.name,
        "sort_name":   r.sort_name,
        "image_path":  r.image_path,
        "genres":      r.genres,
        "album_count": r.album_count,
        "track_count": r.track_count,
    })).collect();

    Ok(Json(json!({ "artists": artists })))
}

pub async fn get_artist(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let artist = sqlx::query!(
        r#"SELECT id, name, sort_name, biography, image_path, genres,
                  country, artist_type, album_count, track_count
           FROM media.artists WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| MediaError::NotFound(format!("Artiste {id}")))?;

    let albums = sqlx::query!(
        r#"SELECT id, title, release_year, cover_path, album_type, track_count
           FROM media.albums WHERE artist_id = $1 ORDER BY release_year DESC NULLS LAST"#,
        id
    )
    .fetch_all(&state.db)
    .await?;

    let top_tracks = sqlx::query!(
        r#"SELECT id, title, duration_secs, play_count, album_id
           FROM media.tracks WHERE artist_id = $1 ORDER BY play_count DESC LIMIT 10"#,
        id
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "id":          artist.id,
        "name":        artist.name,
        "biography":   artist.biography,
        "image_path":  artist.image_path,
        "genres":      artist.genres,
        "country":     artist.country,
        "artist_type": artist.artist_type,
        "album_count": artist.album_count,
        "albums":      albums.iter().map(|a| json!({
            "id":          a.id,
            "title":       a.title,
            "release_year": a.release_year,
            "cover_path":  a.cover_path,
            "album_type":  a.album_type,
            "track_count": a.track_count,
        })).collect::<Vec<_>>(),
        "top_tracks":  top_tracks.iter().map(|t| json!({
            "id":           t.id,
            "title":        t.title,
            "duration_secs": t.duration_secs,
            "play_count":   t.play_count,
            "album_id":     t.album_id,
        })).collect::<Vec<_>>(),
    })))
}
