use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct VideoProgress {
    pub user_id:        Uuid,
    pub item_type:      String,
    pub item_id:        Uuid,
    pub position_secs:  i32,
    pub duration_secs:  i32,
    pub percent_played: f64,
    pub is_watched:     bool,
    pub last_played_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SaveProgressDto {
    pub position_secs: i32,
    pub duration_secs: i32,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ListenHistory {
    pub id:            Uuid,
    pub user_id:       Uuid,
    pub track_id:      Uuid,
    pub listened_secs: i32,
    pub is_complete:   bool,
    pub played_at:     DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct RecordListenDto {
    pub track_id:      Uuid,
    pub listened_secs: i32,
}
