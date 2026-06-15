use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use sqlx::types::JsonValue;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Artist {
    pub id:          Uuid,
    pub library_id:  Option<Uuid>,
    pub mbid:        Option<String>,
    pub name:        String,
    pub sort_name:   Option<String>,
    pub biography:   Option<String>,
    pub image_path:  Option<String>,
    pub genres:      Vec<String>,
    pub country:     Option<String>,
    pub begin_date:  Option<NaiveDate>,
    pub end_date:    Option<NaiveDate>,
    pub artist_type: Option<String>,
    pub album_count: i32,
    pub track_count: i32,
    pub meta_status: String,
    pub created_at:  DateTime<Utc>,
    pub updated_at:  DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Album {
    pub id:           Uuid,
    pub library_id:   Option<Uuid>,
    pub artist_id:    Option<Uuid>,
    pub mbid:         Option<String>,
    pub title:        String,
    pub sort_title:   Option<String>,
    pub release_date: Option<NaiveDate>,
    pub release_year: Option<i32>,
    pub album_type:   String,
    pub cover_path:   Option<String>,
    pub genres:       Vec<String>,
    pub label:        Option<String>,
    pub track_count:  i32,
    pub duration_secs: i32,
    pub meta_status:  String,
    pub created_at:   DateTime<Utc>,
    pub updated_at:   DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Track {
    pub id:                Uuid,
    pub album_id:          Option<Uuid>,
    pub artist_id:         Option<Uuid>,
    pub library_id:        Option<Uuid>,
    pub mbid:              Option<String>,
    pub file_path:         String,
    pub file_size:         i64,
    pub title:             String,
    pub track_number:      Option<i32>,
    pub disc_number:       i32,
    pub duration_secs:     i32,
    pub codec:             Option<String>,
    pub bitrate:           Option<i32>,
    pub sample_rate:       Option<i32>,
    pub bit_depth:         Option<i32>,
    pub channels:          i32,
    pub composer:          Option<String>,
    pub lyricist:          Option<String>,
    pub bpm:               Option<i32>,
    pub lyrics:            Option<String>,
    pub replay_gain_track: Option<f64>,
    pub replay_gain_album: Option<f64>,
    pub meta_status:       String,
    pub play_count:        i32,
    pub created_at:        DateTime<Utc>,
    pub updated_at:        DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Playlist {
    pub id:            Uuid,
    pub owner_id:      Uuid,
    pub name:          String,
    pub description:   Option<String>,
    pub cover_path:    Option<String>,
    pub playlist_type: String,
    pub smart_rules:   Option<JsonValue>,
    pub is_public:     bool,
    pub track_count:   i32,
    pub duration_secs: i32,
    pub created_at:    DateTime<Utc>,
    pub updated_at:    DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePlaylistDto {
    pub name:        String,
    pub description: Option<String>,
    pub is_public:   Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePlaylistDto {
    pub name:        Option<String>,
    pub description: Option<String>,
    pub is_public:   Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AddTracksDto {
    pub track_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ListTracksQuery {
    pub page:   Option<i64>,
    pub limit:  Option<i64>,
    pub sort:   Option<String>,
    pub search: Option<String>,
}
