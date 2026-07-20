use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::JsonValue;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Movie {
    pub id:                  Uuid,
    pub library_id:          Uuid,
    pub file_path:           String,
    pub file_size:           i64,
    pub duration_secs:       i32,
    pub video_codec:         Option<String>,
    pub audio_codec:         Option<String>,
    pub resolution_w:        Option<i32>,
    pub resolution_h:        Option<i32>,
    pub tmdb_id:             Option<i32>,
    pub imdb_id:             Option<String>,
    pub title:               String,
    pub original_title:      Option<String>,
    pub overview:            Option<String>,
    pub tagline:             Option<String>,
    pub release_date:        Option<NaiveDate>,
    pub runtime_mins:        Option<i32>,
    pub poster_path:         Option<String>,
    pub backdrop_path:       Option<String>,
    pub vote_average:        Option<f64>,
    pub vote_count:          Option<i32>,
    pub popularity:          Option<f64>,
    pub genres:              Vec<String>,
    pub original_language:   Option<String>,
    pub production_countries: Vec<String>,
    pub meta_status:         String,
    pub cast_json:           JsonValue,
    pub crew_json:           JsonValue,
    pub subtitles:           JsonValue,
    pub transcode_status:    JsonValue,
    pub created_at:          DateTime<Utc>,
    pub updated_at:          DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TvShow {
    pub id:                Uuid,
    pub library_id:        Uuid,
    pub tmdb_id:           Option<i32>,
    pub tvdb_id:           Option<i32>,
    pub name:              String,
    pub original_name:     Option<String>,
    pub overview:          Option<String>,
    pub tagline:           Option<String>,
    pub first_air_date:    Option<NaiveDate>,
    pub last_air_date:     Option<NaiveDate>,
    pub status:            Option<String>,
    pub poster_path:       Option<String>,
    pub backdrop_path:     Option<String>,
    pub vote_average:      Option<f64>,
    pub vote_count:        Option<i32>,
    pub genres:            Vec<String>,
    pub networks:          Vec<String>,
    pub season_count:      i32,
    pub episode_count:     i32,
    pub original_language: Option<String>,
    pub cast_json:         JsonValue,
    pub crew_json:         JsonValue,
    pub meta_status:       String,
    pub created_at:        DateTime<Utc>,
    pub updated_at:        DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TvSeason {
    pub id:            Uuid,
    pub show_id:       Uuid,
    pub tmdb_id:       Option<i32>,
    pub season_number: i32,
    pub name:          Option<String>,
    pub overview:      Option<String>,
    pub air_date:      Option<NaiveDate>,
    pub poster_path:   Option<String>,
    pub episode_count: i32,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TvEpisode {
    pub id:               Uuid,
    pub season_id:        Uuid,
    pub show_id:          Uuid,
    pub file_path:        Option<String>,
    pub file_size:        Option<i64>,
    pub tmdb_id:          Option<i32>,
    pub episode_number:   i32,
    pub name:             Option<String>,
    pub overview:         Option<String>,
    pub air_date:         Option<NaiveDate>,
    pub still_path:       Option<String>,
    pub vote_average:     Option<f64>,
    pub duration_secs:    Option<i32>,
    pub video_codec:      Option<String>,
    pub audio_codec:      Option<String>,
    pub resolution_w:     Option<i32>,
    pub resolution_h:     Option<i32>,
    pub subtitles:        JsonValue,
    pub transcode_status: JsonValue,
    pub meta_status:      String,
    pub created_at:       DateTime<Utc>,
    pub updated_at:       DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ListMoviesQuery {
    pub page:   Option<i64>,
    pub limit:  Option<i64>,
    pub sort:   Option<String>,
    pub genre:  Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListShowsQuery {
    pub page:   Option<i64>,
    pub limit:  Option<i64>,
    pub sort:   Option<String>,
    pub genre:  Option<String>,
    pub search: Option<String>,
    /// Alias for `search` (the frontend sends `q`).
    pub q:      Option<String>,
}
