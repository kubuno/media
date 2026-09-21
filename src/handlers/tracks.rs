use axum::{
    extract::{Extension, Path, Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use kubuno_db::params;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    models::audio::ListTracksQuery,
    services::lyrics,
    state::AppState,
};

#[derive(sqlx::FromRow)]
struct LyricsRow {
    title:         String,
    duration_secs: Option<i32>,
    lyrics:        Option<String>,
    lyrics_source: Option<String>,
    lyrics_synced: bool,
    album_title:   Option<String>,
    artist_name:   Option<String>,
}

#[derive(sqlx::FromRow)]
struct TrackDetailRow {
    id:            Uuid,
    title:         String,
    track_number:  Option<i32>,
    duration_secs: i32,
    codec:         Option<String>,
    bitrate:       Option<i32>,
    play_count:    i32,
    lyrics:        Option<String>,
    album_id:      Option<Uuid>,
    artist_id:     Option<Uuid>,
    album_title:   Option<String>,
    cover_path:    Option<String>,
    artist_name:   Option<String>,
}

#[derive(sqlx::FromRow)]
struct LikedTrackRow {
    id:            Uuid,
    title:         String,
    duration_secs: i32,
    album_id:      Option<Uuid>,
    album_title:   Option<String>,
    cover_path:    Option<String>,
    artist_name:   Option<String>,
    artist_id:     Option<Uuid>,
    liked_at:      DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct RecentlyPlayedRow {
    id:            Uuid,
    title:         String,
    duration_secs: i32,
    album_id:      Option<Uuid>,
    album_title:   Option<String>,
    cover_path:    Option<String>,
    artist_name:   Option<String>,
    artist_id:     Option<Uuid>,
    played_at:     DateTime<Utc>,
}

/// GET /tracks/:id/lyrics — returns cached/embedded lyrics, or fetches them from
/// free online providers (LRCLIB → lyrics.ovh → ChartLyrics) and caches the hit.
pub async fn get_lyrics(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let row = state
        .db
        .fetch_optional_as::<LyricsRow>(
            r#"SELECT t.title, t.duration_secs, t.lyrics, t.lyrics_source, t.lyrics_synced,
                      al.title AS album_title, ar.name AS artist_name
               FROM media.tracks t
               LEFT JOIN media.albums  al ON al.id = t.album_id
               LEFT JOIN media.artists ar ON ar.id = t.artist_id
               WHERE t.id = $1"#,
            params![id],
        )
        .await?
        .ok_or_else(|| MediaError::NotFound(format!("Piste {id}")))?;

    // Already have lyrics (embedded in the file or previously fetched).
    if let Some(text) = row.lyrics.filter(|s| s.trim().len() > 2) {
        let source = row.lyrics_source.unwrap_or_else(|| "fichier".into());
        return Ok(Json(json!({ "lyrics": text, "synced": row.lyrics_synced, "source": source })));
    }

    // Fetch from the online providers.
    let Some(artist) = row.artist_name.as_deref().filter(|s| !s.is_empty()) else {
        return Ok(Json(json!({ "lyrics": null })));
    };
    match lyrics::fetch(artist, &row.title, row.album_title.as_deref(), row.duration_secs).await {
        Some(found) => {
            // Cache for next time.
            let _ = state
                .db
                .execute(
                    "UPDATE media.tracks SET lyrics = $1, lyrics_source = $2, lyrics_synced = $3 WHERE id = $4",
                    params![&found.text, found.source, found.synced, id],
                )
                .await;
            Ok(Json(json!({ "lyrics": found.text, "synced": found.synced, "source": found.source })))
        }
        None => Ok(Json(json!({ "lyrics": null }))),
    }
}

pub async fn get_track(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let row = state
        .db
        .fetch_optional_as::<TrackDetailRow>(
            r#"SELECT t.id, t.title, t.track_number, t.duration_secs, t.codec, t.bitrate,
                      t.play_count, t.lyrics, t.album_id, t.artist_id,
                      al.title AS album_title, al.cover_path,
                      ar.name AS artist_name
               FROM media.tracks t
               LEFT JOIN media.albums  al ON al.id = t.album_id
               LEFT JOIN media.artists ar ON ar.id = t.artist_id
               WHERE t.id = $1"#,
            params![id],
        )
        .await?
        .ok_or_else(|| MediaError::NotFound(format!("Piste {id}")))?;

    Ok(Json(json!({
        "id":            row.id,
        "title":         row.title,
        "track_number":  row.track_number,
        "duration_secs": row.duration_secs,
        "codec":         row.codec,
        "bitrate":       row.bitrate,
        "play_count":    row.play_count,
        "lyrics":        row.lyrics,
        "album_id":      row.album_id,
        "album_title":   row.album_title,
        "cover_path":    row.cover_path,
        "artist_id":     row.artist_id,
        "artist_name":   row.artist_name,
    })))
}

pub async fn liked_tracks(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Query(_q): Query<ListTracksQuery>,
) -> Result<Json<Value>, MediaError> {
    let rows = state
        .db
        .fetch_all_as::<LikedTrackRow>(
            r#"SELECT t.id, t.title, t.duration_secs, t.album_id,
                      al.title AS album_title, al.cover_path,
                      ar.name AS artist_name, ar.id AS artist_id,
                      lt.liked_at
               FROM media.liked_tracks lt
               JOIN media.tracks  t  ON t.id  = lt.track_id
               LEFT JOIN media.albums  al ON al.id = t.album_id
               LEFT JOIN media.artists ar ON ar.id = t.artist_id
               WHERE lt.user_id = $1
               ORDER BY lt.liked_at DESC"#,
            params![user.id],
        )
        .await?;

    let tracks: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":            r.id,
        "title":         r.title,
        "duration_secs": r.duration_secs,
        "album_id":      r.album_id,
        "album_title":   r.album_title,
        "cover_path":    r.cover_path,
        "artist_id":     r.artist_id,
        "artist_name":   r.artist_name,
        "liked_at":      r.liked_at,
    })).collect();

    Ok(Json(json!({ "tracks": tracks })))
}

pub async fn toggle_like(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(track_id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    // `SELECT EXISTS(...)` decodes as a boolean on PostgreSQL only (an integer
    // on MySQL/SQLite); a presence probe with `LIMIT 1` is portable instead.
    let exists = state
        .db
        .fetch_optional_scalar::<i32>(
            "SELECT 1 FROM media.liked_tracks WHERE user_id = $1 AND track_id = $2 LIMIT 1",
            params![user.id, track_id],
        )
        .await?
        .is_some();

    if exists {
        state
            .db
            .execute(
                "DELETE FROM media.liked_tracks WHERE user_id = $1 AND track_id = $2",
                params![user.id, track_id],
            )
            .await?;
        Ok(Json(json!({ "liked": false })))
    } else {
        let sql = format!(
            "INSERT {}INTO media.liked_tracks (user_id, track_id) VALUES ($1, $2){}",
            state.db.backend().insert_ignore_prefix(),
            state.db.backend().on_conflict_do_nothing(&["user_id", "track_id"]),
        );
        state.db.execute(&sql, params![user.id, track_id]).await?;
        Ok(Json(json!({ "liked": true })))
    }
}

pub async fn recently_played(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    // `DISTINCT ON` is PostgreSQL-only; the portable replacement ranks each
    // track's plays by recency with a window function and keeps rank 1. The
    // final `ORDER BY id` matches the original query, whose `DISTINCT ON
    // (t.id)` forced the output order to start with `t.id` (so this list is
    // ordered by track id, not by play recency — preserved as-is).
    let rows = state
        .db
        .fetch_all_as::<RecentlyPlayedRow>(
            r#"SELECT id, title, duration_secs, album_id, album_title, cover_path,
                      artist_name, artist_id, played_at
               FROM (
                   SELECT t.id, t.title, t.duration_secs, t.album_id,
                          al.title AS album_title, al.cover_path,
                          ar.name AS artist_name, ar.id AS artist_id,
                          lh.played_at,
                          ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY lh.played_at DESC) AS rn
                   FROM media.listen_history lh
                   JOIN media.tracks  t  ON t.id  = lh.track_id
                   LEFT JOIN media.albums  al ON al.id = t.album_id
                   LEFT JOIN media.artists ar ON ar.id = t.artist_id
                   WHERE lh.user_id = $1
               ) ranked
               WHERE rn = 1
               ORDER BY id
               LIMIT 20"#,
            params![user.id],
        )
        .await?;

    let tracks: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":            r.id,
        "title":         r.title,
        "duration_secs": r.duration_secs,
        "album_id":      r.album_id,
        "album_title":   r.album_title,
        "cover_path":    r.cover_path,
        "artist_id":     r.artist_id,
        "artist_name":   r.artist_name,
        "played_at":     r.played_at,
    })).collect();

    Ok(Json(json!({ "tracks": tracks })))
}

pub async fn increment_play_count(id: Uuid, db: &kubuno_db::DbPool) {
    let _ = db
        .execute(
            "UPDATE media.tracks SET play_count = play_count + 1 WHERE id = $1",
            params![id],
        )
        .await;
}

pub async fn like_status(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(track_id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    // `SELECT EXISTS(...)` decodes as a boolean on PostgreSQL only (an integer
    // on MySQL/SQLite); a presence probe with `LIMIT 1` is portable instead.
    let liked = state
        .db
        .fetch_optional_scalar::<i32>(
            "SELECT 1 FROM media.liked_tracks WHERE user_id = $1 AND track_id = $2 LIMIT 1",
            params![user.id, track_id],
        )
        .await?
        .is_some();

    Ok(Json(json!({ "liked": liked })))
}
