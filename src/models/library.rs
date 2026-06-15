use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MediaLibrary {
    pub id:              Uuid,
    pub owner_id:        Option<Uuid>,
    pub name:            String,
    pub lib_type:        String,
    pub path:            String,
    pub icon:            String,
    pub color:           String,
    pub is_shared:       bool,
    pub item_count:      i32,
    pub last_scan_at:    Option<DateTime<Utc>>,
    pub scan_status:     String,
    pub scan_error:      Option<String>,
    pub source_type:     String,
    pub files_folder_id: Option<Uuid>,
    pub files_owner_id:  Option<Uuid>,
    pub created_at:      DateTime<Utc>,
    pub updated_at:      DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateLibraryDto {
    pub name:            String,
    pub lib_type:        String,
    /// Chemin disque (requis pour source_type = 'filesystem', ignoré sinon)
    pub path:            Option<String>,
    pub icon:            Option<String>,
    pub color:           Option<String>,
    pub is_shared:       Option<bool>,
    /// 'filesystem' (défaut) ou 'files_folder'
    pub source_type:     Option<String>,
    /// Requis pour source_type = 'files_folder'
    pub files_folder_id: Option<Uuid>,
    pub files_owner_id:  Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLibraryDto {
    pub name:     Option<String>,
    pub path:     Option<String>,
    pub icon:     Option<String>,
    pub color:    Option<String>,
    pub is_shared: Option<bool>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ScanJob {
    pub id:              Uuid,
    pub library_id:      Uuid,
    pub status:          String,
    pub files_found:     i32,
    pub files_processed: i32,
    pub files_added:     i32,
    pub files_updated:   i32,
    pub error_message:   Option<String>,
    pub started_at:      Option<DateTime<Utc>>,
    pub finished_at:     Option<DateTime<Utc>>,
    pub created_at:      DateTime<Utc>,
}
