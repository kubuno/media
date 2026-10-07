use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use kubuno_db::params;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    models::audio::{AddTracksDto, CreatePlaylistDto, UpdatePlaylistDto},
    state::AppState,
};

// Row shapes for the runtime queries (one binary, three engines: kubuno-db).
#[derive(sqlx::FromRow)]
struct PlaylistRow {
    id:            Uuid,
    name:          String,
    description:   Option<String>,
    cover_path:    Option<String>,
    playlist_type: String,
    is_public:     bool,
    track_count:   i32,
    duration_secs: i32,
    created_at:    DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct PlaylistDetailRow {
    id:            Uuid,
    owner_id:      Uuid,
    name:          String,
    description:   Option<String>,
    cover_path:    Option<String>,
    playlist_type: String,
    is_public:     bool,
    track_count:   i32,
    duration_secs: i32,
    created_at:    DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct PlaylistTrackRow {
    id:            Uuid,
    title:         String,
    duration_secs: i32,
    album_id:      Option<Uuid>,
    album_title:   Option<String>,
    cover_path:    Option<String>,
    artist_name:   Option<String>,
    artist_id:     Option<Uuid>,
    position:      i32,
}

/// Track id alone, for the position renumbering in [`remove_track`].
#[derive(sqlx::FromRow)]
struct PlaylistTrackIdRow {
    track_id: Uuid,
}

pub async fn list_playlists(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = state
        .db
        .fetch_all_as::<PlaylistRow>(
            r#"SELECT id, name, description, cover_path, playlist_type,
                      is_public, track_count, duration_secs, created_at
               FROM media.playlists
               WHERE owner_id = $1 OR is_public = TRUE
               ORDER BY created_at DESC"#,
            params![user.id],
        )
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
    let playlist = state
        .db
        .fetch_optional_as::<PlaylistDetailRow>(
            r#"SELECT id, owner_id, name, description, cover_path, playlist_type,
                      is_public, track_count, duration_secs, created_at
               FROM media.playlists
               WHERE id = $1 AND (owner_id = $2 OR is_public = TRUE)"#,
            params![id, user.id],
        )
        .await?
        .ok_or_else(|| MediaError::NotFound(format!("Playlist {id}")))?;

    let tracks = state
        .db
        .fetch_all_as::<PlaylistTrackRow>(
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
            params![id],
        )
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
    let id = kubuno_db::new_id();
    state
        .db
        .execute(
            r#"INSERT INTO media.playlists (id, owner_id, name, description, is_public)
               VALUES ($1, $2, $3, $4, $5)"#,
            params![id, user.id, dto.name, dto.description, dto.is_public.unwrap_or(false)],
        )
        .await?;

    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

pub async fn update_playlist(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(dto): Json<UpdatePlaylistDto>,
) -> Result<Json<Value>, MediaError> {
    // `SELECT EXISTS(...)` decodes as a boolean on PostgreSQL only (an integer
    // on MySQL/SQLite); a presence probe with `LIMIT 1` is portable instead.
    let exists = state
        .db
        .fetch_optional_scalar::<i32>(
            "SELECT 1 FROM media.playlists WHERE id = $1 AND owner_id = $2 LIMIT 1",
            params![id, user.id],
        )
        .await?
        .is_some();

    if !exists {
        return Err(MediaError::NotFound(format!("Playlist {id}")));
    }

    state
        .db
        .execute(
            r#"UPDATE media.playlists
               SET name        = COALESCE($3, name),
                   description = COALESCE($4, description),
                   is_public   = COALESCE($5, is_public)
               WHERE id = $1 AND owner_id = $2"#,
            params![id, user.id, dto.name, dto.description, dto.is_public],
        )
        .await?;

    Ok(Json(json!({ "updated": true })))
}

pub async fn delete_playlist(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, MediaError> {
    let rows_affected = state
        .db
        .execute(
            "DELETE FROM media.playlists WHERE id = $1 AND owner_id = $2",
            params![id, user.id],
        )
        .await?;

    if rows_affected == 0 {
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
    // Verify ownership. See the note in `update_playlist` about `EXISTS`.
    let exists = state
        .db
        .fetch_optional_scalar::<i32>(
            "SELECT 1 FROM media.playlists WHERE id = $1 AND owner_id = $2 LIMIT 1",
            params![id, user.id],
        )
        .await?
        .is_some();

    if !exists {
        return Err(MediaError::NotFound(format!("Playlist {id}")));
    }

    // Get current max position
    let max_pos: Option<i32> = state
        .db
        .fetch_scalar(
            "SELECT MAX(position) FROM media.playlist_tracks WHERE playlist_id = $1",
            params![id],
        )
        .await?;

    let base_pos = max_pos.unwrap_or(0) + 1;

    let insert_sql = format!(
        "INSERT {}INTO media.playlist_tracks (playlist_id, track_id, position, added_by) VALUES ($1, $2, $3, $4){}",
        state.db.backend().insert_ignore_prefix(),
        state.db.backend().on_conflict_do_nothing(&["playlist_id", "track_id"]),
    );
    for (offset, track_id) in dto.track_ids.iter().enumerate() {
        let pos = base_pos + offset as i32;
        state.db.execute(&insert_sql, params![id, track_id, pos, user.id]).await?;
    }

    // Refresh track_count and duration_secs
    state
        .db
        .execute(
            r#"UPDATE media.playlists
               SET track_count   = (SELECT COUNT(*) FROM media.playlist_tracks WHERE playlist_id = $1),
                   duration_secs = (SELECT COALESCE(SUM(t.duration_secs), 0)
                                    FROM media.playlist_tracks pt
                                    JOIN media.tracks t ON t.id = pt.track_id
                                    WHERE pt.playlist_id = $1)
               WHERE id = $1"#,
            params![id],
        )
        .await?;

    Ok(Json(json!({ "added": dto.track_ids.len() })))
}

pub async fn remove_track(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path((id, track_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, MediaError> {
    // Verify ownership. See the note in `update_playlist` about `EXISTS`.
    let exists = state
        .db
        .fetch_optional_scalar::<i32>(
            "SELECT 1 FROM media.playlists WHERE id = $1 AND owner_id = $2 LIMIT 1",
            params![id, user.id],
        )
        .await?
        .is_some();

    if !exists {
        return Err(MediaError::NotFound(format!("Playlist {id}")));
    }

    state
        .db
        .execute(
            "DELETE FROM media.playlist_tracks WHERE playlist_id = $1 AND track_id = $2",
            params![id, track_id],
        )
        .await?;

    // Reorder positions to close the gap left by the deleted track. The
    // original query keyed a window function on the physical row id
    // (PostgreSQL's `ctid`), which has no equivalent on MySQL/SQLite; the
    // table's primary key is (playlist_id, track_id), so the remaining rows
    // are fetched in position order and renumbered one by one instead.
    let remaining = state
        .db
        .fetch_all_as::<PlaylistTrackIdRow>(
            "SELECT track_id FROM media.playlist_tracks WHERE playlist_id = $1 ORDER BY position",
            params![id],
        )
        .await?;

    for (idx, row) in remaining.iter().enumerate() {
        state
            .db
            .execute(
                "UPDATE media.playlist_tracks SET position = $1 WHERE playlist_id = $2 AND track_id = $3",
                params![(idx as i32) + 1, id, row.track_id],
            )
            .await?;
    }

    // Refresh counts
    state
        .db
        .execute(
            r#"UPDATE media.playlists
               SET track_count   = (SELECT COUNT(*) FROM media.playlist_tracks WHERE playlist_id = $1),
                   duration_secs = (SELECT COALESCE(SUM(t.duration_secs), 0)
                                    FROM media.playlist_tracks pt
                                    JOIN media.tracks t ON t.id = pt.track_id
                                    WHERE pt.playlist_id = $1)
               WHERE id = $1"#,
            params![id],
        )
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
