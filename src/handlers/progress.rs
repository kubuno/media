use axum::{
    extract::{Extension, Path, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    models::progress::{RecordListenDto, SaveProgressDto},
    state::AppState,
};

pub async fn save_video_progress(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path((item_type, item_id)): Path<(String, Uuid)>,
    Json(dto): Json<SaveProgressDto>,
) -> Result<Json<Value>, MediaError> {
    if !["movie", "episode"].contains(&item_type.as_str()) {
        return Err(MediaError::Validation("item_type must be 'movie' or 'episode'".into()));
    }

    let percent = if dto.duration_secs > 0 {
        (dto.position_secs as f64 / dto.duration_secs as f64 * 100.0) as i32
    } else {
        0
    };
    let is_watched = percent >= 90;

    sqlx::query!(
        r#"INSERT INTO media.video_progress
               (user_id, item_type, item_id, position_secs, duration_secs, percent_played, is_watched)
           VALUES ($1, $2, $3, $4, $5, $6::NUMERIC, $7)
           ON CONFLICT (user_id, item_type, item_id) DO UPDATE
               SET position_secs  = EXCLUDED.position_secs,
                   duration_secs  = EXCLUDED.duration_secs,
                   percent_played = EXCLUDED.percent_played,
                   is_watched     = EXCLUDED.is_watched,
                   last_played_at = NOW()"#,
        user.id,
        item_type,
        item_id,
        dto.position_secs,
        dto.duration_secs,
        percent as f64,
        is_watched,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "saved": true, "is_watched": is_watched })))
}

pub async fn get_video_progress(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path((item_type, item_id)): Path<(String, Uuid)>,
) -> Result<Json<Value>, MediaError> {
    let row = sqlx::query!(
        r#"SELECT position_secs, duration_secs, percent_played::FLOAT8, is_watched, last_played_at
           FROM media.video_progress
           WHERE user_id = $1 AND item_type = $2 AND item_id = $3"#,
        user.id, item_type, item_id
    )
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some(r) => Ok(Json(json!({
            "position_secs":  r.position_secs,
            "duration_secs":  r.duration_secs,
            "percent_played": r.percent_played,
            "is_watched":     r.is_watched,
            "last_played_at": r.last_played_at,
        }))),
        None => Ok(Json(json!({
            "position_secs":  0,
            "duration_secs":  0,
            "percent_played": 0,
            "is_watched":     false,
            "last_played_at": null,
        }))),
    }
}

pub async fn record_listen(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(dto): Json<RecordListenDto>,
) -> Result<Json<Value>, MediaError> {
    sqlx::query!(
        r#"INSERT INTO media.listen_history (user_id, track_id, listened_secs, is_complete)
           VALUES ($1, $2, $3, $4)"#,
        user.id,
        dto.track_id,
        dto.listened_secs,
        dto.listened_secs > 0,
    )
    .execute(&state.db)
    .await?;

    // Increment play_count
    super::tracks::increment_play_count(dto.track_id, &state.db).await;

    Ok(Json(json!({ "recorded": true })))
}

pub async fn get_listen_history(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query!(
        r#"SELECT lh.id, lh.track_id, lh.listened_secs, lh.is_complete, lh.played_at,
                  t.title, ar.name AS artist_name, al.title AS album_title
           FROM media.listen_history lh
           JOIN media.tracks  t  ON t.id  = lh.track_id
           LEFT JOIN media.artists ar ON ar.id = t.artist_id
           LEFT JOIN media.albums  al ON al.id = t.album_id
           WHERE lh.user_id = $1
           ORDER BY lh.played_at DESC
           LIMIT 100"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;

    let history: Vec<Value> = rows.into_iter().map(|r| json!({
        "id":            r.id,
        "track_id":      r.track_id,
        "title":         r.title,
        "artist_name":   r.artist_name,
        "album_title":   r.album_title,
        "listened_secs": r.listened_secs,
        "is_complete":   r.is_complete,
        "played_at":     r.played_at,
    })).collect();

    Ok(Json(json!({ "history": history })))
}
