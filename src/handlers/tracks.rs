use axum::{
    extract::{Extension, Path, Query, State},
    Json,
};
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

/// GET /tracks/:id/lyrics — returns cached/embedded lyrics, or fetches them from
/// free online providers (LRCLIB → lyrics.ovh → ChartLyrics) and caches the hit.
pub async fn get_lyrics(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let row = sqlx::query_as::<_, LyricsRow>(
        r#"SELECT t.title, t.duration_secs, t.lyrics, t.lyrics_source, t.lyrics_synced,
                  al.title AS album_title, ar.name AS artist_name
           FROM media.tracks t
           LEFT JOIN media.albums  al ON al.id = t.album_id
           LEFT JOIN media.artists ar ON ar.id = t.artist_id
           WHERE t.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
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
            let _ = sqlx::query(
                "UPDATE media.tracks SET lyrics = $1, lyrics_source = $2, lyrics_synced = $3 WHERE id = $4",
            )
            .bind(&found.text)
            .bind(found.source)
            .bind(found.synced)
            .bind(id)
            .execute(&state.db)
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
    let row = sqlx::query!(
        r#"SELECT t.id, t.title, t.track_number, t.duration_secs, t.codec, t.bitrate,
                  t.play_count, t.lyrics, t.album_id, t.artist_id,
                  al.title AS album_title, al.cover_path,
                  ar.name AS artist_name
           FROM media.tracks t
           LEFT JOIN media.albums  al ON al.id = t.album_id
           LEFT JOIN media.artists ar ON ar.id = t.artist_id
           WHERE t.id = $1"#,
        id
    )
    .fetch_optional(&state.db)
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
    let rows = sqlx::query!(
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
        user.id
    )
    .fetch_all(&state.db)
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
    let exists: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM media.liked_tracks WHERE user_id = $1 AND track_id = $2)",
        user.id, track_id
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if exists {
        sqlx::query!(
            "DELETE FROM media.liked_tracks WHERE user_id = $1 AND track_id = $2",
            user.id, track_id
        )
        .execute(&state.db)
        .await?;
        Ok(Json(json!({ "liked": false })))
    } else {
        sqlx::query!(
            "INSERT INTO media.liked_tracks (user_id, track_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            user.id, track_id
        )
        .execute(&state.db)
        .await?;
        Ok(Json(json!({ "liked": true })))
    }
}

pub async fn recently_played(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query!(
        r#"SELECT DISTINCT ON (t.id)
                  t.id, t.title, t.duration_secs, t.album_id,
                  al.title AS album_title, al.cover_path,
                  ar.name AS artist_name, ar.id AS artist_id,
                  lh.played_at
           FROM media.listen_history lh
           JOIN media.tracks  t  ON t.id  = lh.track_id
           LEFT JOIN media.albums  al ON al.id = t.album_id
           LEFT JOIN media.artists ar ON ar.id = t.artist_id
           WHERE lh.user_id = $1
           ORDER BY t.id, lh.played_at DESC
           LIMIT 20"#,
        user.id
    )
    .fetch_all(&state.db)
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

pub async fn increment_play_count(id: Uuid, db: &sqlx::PgPool) {
    let _ = sqlx::query!(
        "UPDATE media.tracks SET play_count = play_count + 1 WHERE id = $1",
        id
    )
    .execute(db)
    .await;
}

pub async fn like_status(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(track_id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let liked: bool = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM media.liked_tracks WHERE user_id = $1 AND track_id = $2)",
        user.id, track_id
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    Ok(Json(json!({ "liked": liked })))
}
