use axum::{
    extract::{Extension, Path, State},
    Json,
};
use kubuno_db::params;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{errors::MediaError, middleware::auth::AuthUser, state::AppState};

// Row shapes for the runtime queries (one binary, three engines: kubuno-db).
#[derive(sqlx::FromRow)]
struct AlbumListRow {
    id:            Uuid,
    title:         String,
    release_year:  Option<i32>,
    cover_path:    Option<String>,
    album_type:    String,
    track_count:   i32,
    duration_secs: i32,
    artist_name:   String,
    artist_id:     Option<Uuid>,
}

#[derive(sqlx::FromRow)]
struct AlbumDetailRow {
    id:            Uuid,
    title:         String,
    release_date:  Option<chrono::NaiveDate>,
    release_year:  Option<i32>,
    album_type:    String,
    cover_path:    Option<String>,
    #[sqlx(json)]
    genres:        Vec<String>,
    label:         Option<String>,
    track_count:   i32,
    duration_secs: i32,
    mbid:          Option<String>,
    meta_status:   String,
    meta_locked:   bool,
    artist_id:     Option<Uuid>,
    artist_name:   String,
    artist_image:  Option<String>,
}

#[derive(sqlx::FromRow)]
struct AlbumTrackRow {
    id:            Uuid,
    title:         String,
    track_number:  Option<i32>,
    disc_number:   i32,
    duration_secs: i32,
    codec:         Option<String>,
    play_count:    i32,
    artist_name:   Option<String>,
}

#[derive(sqlx::FromRow)]
struct RecentAlbumRow {
    id:           Uuid,
    title:        String,
    release_year: Option<i32>,
    cover_path:   Option<String>,
    artist_name:  Option<String>,
}

pub async fn list_albums(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = state.db.fetch_all_as::<AlbumListRow>(
        r#"SELECT a.id, a.title, a.release_year, a.cover_path, a.album_type,
                  a.track_count, a.duration_secs, ar.name AS artist_name, ar.id AS artist_id
           FROM media.albums a
           LEFT JOIN media.artists ar ON ar.id = a.artist_id
           ORDER BY a.title"#,
        params![],
    ).await?;

    // Backfill missing album covers from Deezer in the background (free, key-less),
    // so the grid fills in on a later load without blocking this response. Mirrors
    // the artist-photo backfill in `artists.rs`.
    let missing: Vec<(Uuid, String, String)> = rows
        .iter()
        .filter(|r| r.cover_path.is_none() && !r.artist_name.trim().is_empty())
        .map(|r| (r.id, r.artist_name.clone(), r.title.clone()))
        .take(30)
        .collect();
    if !missing.is_empty() {
        let db = state.db.clone();
        tokio::spawn(async move {
            for (id, artist, title) in missing {
                if let Some(url) = crate::services::deezer::album_cover(&artist, &title).await {
                    let _ = db.execute(
                        "UPDATE media.albums SET cover_path = $1 WHERE id = $2 AND cover_path IS NULL",
                        params![url, id],
                    ).await;
                }
            }
        });
    }

    let albums: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":           r.id,
        "title":        r.title,
        "release_year": r.release_year,
        "cover_path":   r.cover_path,
        "album_type":   r.album_type,
        "track_count":  r.track_count,
        "duration_secs": r.duration_secs,
        "artist_name":  r.artist_name,
        "artist_id":    r.artist_id,
    })).collect();

    Ok(Json(json!({ "albums": albums })))
}

pub async fn get_album(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let album = state.db.fetch_optional_as::<AlbumDetailRow>(
        r#"SELECT a.id, a.title, a.release_date, a.release_year, a.album_type,
                  a.cover_path, a.genres, a.label, a.track_count, a.duration_secs,
                  a.mbid, a.meta_status, a.meta_locked,
                  ar.id AS artist_id, ar.name AS artist_name, ar.image_path AS artist_image
           FROM media.albums a
           LEFT JOIN media.artists ar ON ar.id = a.artist_id
           WHERE a.id = $1"#,
        params![id],
    ).await?
    .ok_or_else(|| MediaError::NotFound(format!("Album {id}")))?;

    let tracks = state.db.fetch_all_as::<AlbumTrackRow>(
        r#"SELECT t.id, t.title, t.track_number, t.disc_number,
                  t.duration_secs, t.codec, t.play_count, ar.name AS artist_name
           FROM media.tracks t
           LEFT JOIN media.artists ar ON ar.id = t.artist_id
           WHERE t.album_id = $1
           ORDER BY t.disc_number, t.track_number NULLS LAST"#,
        params![id],
    ).await?;

    // No local cover? Fetch one from Deezer (free, key-less) and cache it, so the
    // album detail view AND the player (which carries this cover) show artwork.
    let mut cover_path = album.cover_path.clone();
    if cover_path.is_none() && !album.artist_name.trim().is_empty() {
        if let Some(url) = crate::services::deezer::album_cover(&album.artist_name, &album.title).await {
            let _ = state.db.execute(
                "UPDATE media.albums SET cover_path = $1 WHERE id = $2",
                params![url.clone(), id],
            ).await;
            cover_path = Some(url);
        }
    }

    Ok(Json(json!({
        "id":           album.id,
        "title":        album.title,
        "release_date": album.release_date,
        "release_year": album.release_year,
        "album_type":   album.album_type,
        "cover_path":   cover_path,
        "genres":       album.genres,
        "label":        album.label,
        "mbid":         album.mbid,
        "meta_status":  album.meta_status,
        "meta_locked":  album.meta_locked,
        "track_count":  album.track_count,
        "duration_secs": album.duration_secs,
        "artist_id":    album.artist_id,
        "artist_name":  album.artist_name,
        "artist_image": album.artist_image,
        "tracks":       tracks.iter().map(|t| json!({
            "id":            t.id,
            "title":         t.title,
            "track_number":  t.track_number,
            "disc_number":   t.disc_number,
            "duration_secs": t.duration_secs,
            "codec":         t.codec,
            "play_count":    t.play_count,
            "artist_name":   t.artist_name,
        })).collect::<Vec<_>>(),
    })))
}

/// GET /albums/:id/cover — serve the locally-cached album artwork (folder
/// image or embedded art extracted at scan time).
pub async fn get_album_cover(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<axum::response::Response, MediaError> {
    use axum::response::IntoResponse;

    let base = crate::services::covers::covers_base(&state.settings);
    let file = crate::services::covers::cached_cover_file(&base, id);
    let bytes = tokio::fs::read(&file)
        .await
        .map_err(|_| MediaError::NotFound(format!("Pochette de l'album {id}")))?;

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "image/jpeg"),
            (axum::http::header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        bytes,
    )
        .into_response())
}

pub async fn recent_albums(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = state.db.fetch_all_as::<RecentAlbumRow>(
        r#"SELECT a.id, a.title, a.release_year, a.cover_path, ar.name AS artist_name
           FROM media.albums a
           LEFT JOIN media.artists ar ON ar.id = a.artist_id
           ORDER BY a.created_at DESC
           LIMIT 20"#,
        params![],
    ).await?;

    let albums: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":           r.id,
        "title":        r.title,
        "release_year": r.release_year,
        "cover_path":   r.cover_path,
        "artist_name":  r.artist_name,
    })).collect();

    Ok(Json(json!({ "albums": albums })))
}
