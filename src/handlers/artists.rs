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
struct ArtistListRow {
    id:          Uuid,
    name:        String,
    sort_name:   Option<String>,
    image_path:  Option<String>,
    #[sqlx(json)]
    genres:      Vec<String>,
    album_count: i32,
    track_count: i32,
}

#[derive(sqlx::FromRow)]
#[allow(dead_code)] // over-selects; some columns decoded but unused here
struct ArtistDetailRow {
    id:          Uuid,
    name:        String,
    sort_name:   Option<String>,
    biography:   Option<String>,
    image_path:  Option<String>,
    #[sqlx(json)]
    genres:      Vec<String>,
    country:     Option<String>,
    artist_type: Option<String>,
    album_count: i32,
    track_count: i32,
    mbid:        Option<String>,
    begin_date:  Option<chrono::NaiveDate>,
    end_date:    Option<chrono::NaiveDate>,
    meta_status: String,
    meta_locked: bool,
}

#[derive(sqlx::FromRow)]
struct ArtistAlbumRow {
    id:           Uuid,
    title:        String,
    release_year: Option<i32>,
    cover_path:   Option<String>,
    album_type:   String,
    track_count:  i32,
}

#[derive(sqlx::FromRow)]
struct ArtistTopTrackRow {
    id:            Uuid,
    title:         String,
    duration_secs: i32,
    play_count:    i32,
    album_id:      Option<Uuid>,
}

pub async fn list_artists(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = state.db.fetch_all_as::<ArtistListRow>(
        r#"SELECT id, name, sort_name, image_path, genres, album_count, track_count
           FROM media.artists ORDER BY COALESCE(sort_name, name)"#,
        params![],
    ).await?;

    // Backfill missing artist photos from Deezer in the background so the grid
    // fills in on a later load without blocking this response.
    let missing: Vec<(Uuid, String)> = rows
        .iter()
        .filter(|r| r.image_path.is_none())
        .take(30)
        .map(|r| (r.id, r.name.clone()))
        .collect();
    if !missing.is_empty() {
        let db = state.db.clone();
        tokio::spawn(async move {
            for (id, name) in missing {
                if let Some(url) = crate::services::deezer::artist_image(&name).await {
                    let _ = db.execute(
                        "UPDATE media.artists SET image_path = $1 WHERE id = $2 AND image_path IS NULL",
                        params![url, id],
                    ).await;
                }
            }
        });
    }

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
    let artist = state.db.fetch_optional_as::<ArtistDetailRow>(
        r#"SELECT id, name, sort_name, biography, image_path, genres,
                  country, artist_type, album_count, track_count,
                  mbid, begin_date, end_date, meta_status, meta_locked
           FROM media.artists WHERE id = $1"#,
        params![id],
    ).await?
    .ok_or_else(|| MediaError::NotFound(format!("Artiste {id}")))?;

    let albums = state.db.fetch_all_as::<ArtistAlbumRow>(
        r#"SELECT id, title, release_year, cover_path, album_type, track_count
           FROM media.albums WHERE artist_id = $1 ORDER BY release_year DESC NULLS LAST"#,
        params![id],
    ).await?;

    let top_tracks = state.db.fetch_all_as::<ArtistTopTrackRow>(
        r#"SELECT id, title, duration_secs, play_count, album_id
           FROM media.tracks WHERE artist_id = $1 ORDER BY play_count DESC LIMIT 10"#,
        params![id],
    ).await?;

    // No local photo? Fetch one from Deezer (free, key-less) and cache it.
    let mut image_path = artist.image_path.clone();
    if image_path.is_none() {
        if let Some(url) = crate::services::deezer::artist_image(&artist.name).await {
            let _ = state.db.execute(
                "UPDATE media.artists SET image_path = $1 WHERE id = $2",
                params![url.clone(), id],
            ).await;
            image_path = Some(url);
        }
    }

    Ok(Json(json!({
        "id":          artist.id,
        "name":        artist.name,
        "biography":   artist.biography,
        "image_path":  image_path,
        "genres":      artist.genres,
        "country":     artist.country,
        "artist_type": artist.artist_type,
        "mbid":        artist.mbid,
        "begin_date":  artist.begin_date,
        "end_date":    artist.end_date,
        "meta_status": artist.meta_status,
        "meta_locked": artist.meta_locked,
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
