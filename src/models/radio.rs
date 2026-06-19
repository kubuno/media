//! Web radio domain models: stations, favorites, recent. Stations are either
//! builtin (curated catalogue, `slug` set, `owner_id` NULL) or user-added.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct RadioStation {
    pub id:          Uuid,
    pub name:        String,
    pub stream_url:  String,
    pub homepage:    Option<String>,
    pub favicon:     Option<String>,
    pub tags:        Vec<String>,
    pub country:     Option<String>,
    pub language:    Option<String>,
    pub codec:       Option<String>,
    pub bitrate:     Option<i32>,
    pub is_builtin:  bool,
    pub owner_id:    Option<Uuid>,
    pub click_count: i64,
}

/// Payload to create/update a custom station.
#[derive(Debug, Deserialize)]
pub struct UpsertStationDto {
    pub name:       String,
    pub stream_url: String,
    #[serde(default)]
    pub homepage:   Option<String>,
    #[serde(default)]
    pub favicon:    Option<String>,
    #[serde(default)]
    pub tags:       Vec<String>,
    #[serde(default)]
    pub country:    Option<String>,
    #[serde(default)]
    pub language:   Option<String>,
    #[serde(default)]
    pub codec:      Option<String>,
    #[serde(default)]
    pub bitrate:    Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct ListStationsQuery {
    #[serde(default)]
    pub q:       Option<String>,
    #[serde(default)]
    pub tag:     Option<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub mine:    Option<bool>,
    #[serde(default)]
    pub limit:   Option<i64>,
    #[serde(default)]
    pub offset:  Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct DiscoverQuery {
    pub q:        String,
    #[serde(default)]
    pub limit:    Option<i64>,
}
