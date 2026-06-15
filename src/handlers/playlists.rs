use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    models::audio::{AddTracksDto, CreatePlaylistDto, UpdatePlaylistDto},
    state::AppState,
};

pub async fn list_playlists(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query!(
        r#"SELECT id, name, description, cover_path, playlist_type,
                  is_public, track_count, duration_secs, created_at
           FROM media.playlists
           WHERE owner_id = $1 OR is_public = TRUE
           ORDER BY created_at DESC"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;

    let playlists: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":            r.id,
        "name":          r.name,
        "description":   r.description,
        "cover_path":    r.cover_path,
        "playlist_type": r.playlist_type,
        "is_public":     r.is_public,
        "track_count":   r.track_count,
        "duration_secs": r.duration_secs,
        "created_at":    r.created_at,
    })).collect();

    Ok(Json(json!({ "playlists": playlists })))
}

pub async fn get_playlist(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let playlist = sqlx::query!(
        r#"SELECT id, owner_id, name, description, cover_path, playlist_type,
                  is_public, track_count, duration_secs, created_at
           FROM media.playlists
           WHERE id = $1 AND (owner_id = $2 OR is_public = TRUE)"#,
        id, user.id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| MediaError::NotFound(format!("Playlist {id}")))?;

    let tracks = sqlx::query!(
        r#"SELECT t.id, t.title, t.duration_secs, t.album_id,
                  al.title AS album_title, al.cover_path,
                  ar.name AS artist_name, ar.id AS artist_id,
                  pt.position
           FROM media.playlist_tracks pt
           JOIN media.tracks t ON t.id = pt.track_id
           LEFT JOIN media.albums al ON al.id = t.album_id
           LEFT JOIN media.artists ar ON ar.id = t.artist_id
           WHERE pt.playlist_id = $1
           ORDER BY pt.position"#,
        id
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "id":            playlist.id,
        "owner_id":      playlist.owner_id,
        "name":          playlist.name,
        "description":   playlist.description,
        "cover_path":    playlist.cover_path,
        "playlist_type": playlist.playlist_type,
        "is_public":     playlist.is_public,
        "track_count":   playlist.track_count,
        "duration_secs": playlist.duration_secs,
        "created_at":    playlist.created_at,
        "tracks":        tracks.iter().map(|t| json!({
            "id":            t.id,
            "title":         t.title,
            "duration_secs": t.duration_secs,
            "album_id":      t.album_id,
            "album_title":   t.album_title,
            "cover_path":    t.cover_path,
            "artist_id":     t.artist_id,
            "artist_name":   t.artist_name,
            "position":      t.position,
        })).collect::<Vec<_>>(),
    })))
}

pub async fn create_playlist(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(dto): Json<CreatePlaylistDto>,
) -> Result<(StatusCode, Json<Value>), MediaError> {
    let id = sqlx::query_scalar!(
        r#"INSERT INTO media.playlists (owner_id, name, description, is_public)
           VALUES ($1, $2, $3, $4) RETURNING id"#,
        user.id,
        dto.name,
        dto.description,
        dto.is_public.unwrap_or(false),
    )
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

pub async fn update_playlist(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(dto): Json<UpdatePlaylistDto>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query!(
        r#"UPDATE media.playlists
           SET name        = COALESCE($3, name),
               description = COALESCE($4, description),
               is_public   = COALESCE($5, is_public)
           WHERE id = $1 AND owner_id = $2
           RETURNING id"#,
        id,
        user.id,
        dto.name,
        dto.description,
        dto.is_public,
    )
    .fetch_optional(&state.db)
    .await?;

    if rows.is_none() {
        return Err(MediaError::NotFound(format!("Playlist {id}")));
    }

    Ok(Json(json!({ "updated": true })))
}

pub async fn delete_playlist(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, MediaError> {
    let result = sqlx::query!(
        "DELETE FROM media.playlists WHERE id = $1 AND owner_id = $2",
        id, user.id
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(MediaError::NotFound(format!("Playlist {id}")));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_tracks(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(dto): Json<AddTracksDto>,
) -> Result<Json<Value>, MediaError> {
    // Verify ownership
    let exists: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM media.playlists WHERE id = $1 AND owner_id = $2)",
        id, user.id
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !exists {
        return Err(MediaError::NotFound(format!("Playlist {id}")));
    }

    // Get current max position
    let max_pos: Option<i32> = sqlx::query_scalar!(
        "SELECT MAX(position) FROM media.playlist_tracks WHERE playlist_id = $1",
        id
    )
    .fetch_one(&state.db)
    .await?;

    let mut pos = max_pos.unwrap_or(0) + 1;

    for track_id in &dto.track_ids {
        sqlx::query!(
            "INSERT INTO media.playlist_tracks (playlist_id, track_id, position, added_by)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
            id, track_id, pos, user.id
        )
        .execute(&state.db)
        .await?;
        pos += 1;
    }

    // Refresh track_count and duration_secs
    sqlx::query!(
        r#"UPDATE media.playlists
           SET track_count   = (SELECT COUNT(*) FROM media.playlist_tracks WHERE playlist_id = $1),
               duration_secs = (SELECT COALESCE(SUM(t.duration_secs), 0)
                                FROM media.playlist_tracks pt
                                JOIN media.tracks t ON t.id = pt.track_id
                                WHERE pt.playlist_id = $1)
           WHERE id = $1"#,
        id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "added": dto.track_ids.len() })))
}

pub async fn remove_track(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path((id, track_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, MediaError> {
    // Verify ownership
    let exists: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM media.playlists WHERE id = $1 AND owner_id = $2)",
        id, user.id
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !exists {
        return Err(MediaError::NotFound(format!("Playlist {id}")));
    }

    sqlx::query!(
        "DELETE FROM media.playlist_tracks WHERE playlist_id = $1 AND track_id = $2",
        id, track_id
    )
    .execute(&state.db)
    .await?;

    // Reorder positions
    sqlx::query!(
        r#"WITH ranked AS (
               SELECT ctid, ROW_NUMBER() OVER (ORDER BY position) AS rn
               FROM media.playlist_tracks WHERE playlist_id = $1
           )
           UPDATE media.playlist_tracks pt SET position = r.rn
           FROM ranked r WHERE pt.ctid = r.ctid"#,
        id
    )
    .execute(&state.db)
    .await?;

    // Refresh counts
    sqlx::query!(
        r#"UPDATE media.playlists
           SET track_count   = (SELECT COUNT(*) FROM media.playlist_tracks WHERE playlist_id = $1),
               duration_secs = (SELECT COALESCE(SUM(t.duration_secs), 0)
                                FROM media.playlist_tracks pt
                                JOIN media.tracks t ON t.id = pt.track_id
                                WHERE pt.playlist_id = $1)
           WHERE id = $1"#,
        id
    )
    .execute(&state.db)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}
