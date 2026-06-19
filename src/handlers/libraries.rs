use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use kubuno_storage::path::user_folder_dir;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    models::library::{CreateLibraryDto, MediaLibrary, UpdateLibraryDto},
    state::AppState,
    workers::scan,
};

pub async fn list_libraries(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query_as!(
        MediaLibrary,
        r#"SELECT id, owner_id, name, lib_type, path, icon, color,
                  is_shared, item_count, last_scan_at, scan_status,
                  scan_error, source_type, files_folder_id, files_owner_id,
                  created_at, updated_at
           FROM media.libraries
           WHERE is_shared = TRUE OR owner_id = $1
           ORDER BY name"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({ "libraries": rows })))
}

pub async fn create_library(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(dto): Json<CreateLibraryDto>,
) -> Result<(StatusCode, Json<Value>), MediaError> {
    if user.role != "admin" {
        return Err(MediaError::Forbidden);
    }
    if !["movies", "shows", "music", "home_videos"].contains(&dto.lib_type.as_str()) {
        return Err(MediaError::Validation("lib_type invalide".into()));
    }

    let source_type = dto.source_type.as_deref().unwrap_or("filesystem");

    let row: MediaLibrary = if source_type == "files_folder" {
        let folder_id = dto.files_folder_id
            .ok_or_else(|| MediaError::Validation("files_folder_id requis pour source files_folder".into()))?;
        let owner_id = dto.files_owner_id
            .ok_or_else(|| MediaError::Validation("files_owner_id requis pour source files_folder".into()))?;
        let base = state.settings.storage.files_storage_base.as_deref()
            .ok_or_else(|| MediaError::Validation("storage.files_storage_base non configuré sur ce serveur".into()))?;

        let folder_path: String = sqlx::query_scalar!(
            "SELECT path FROM drive.folders WHERE id = $1 AND owner_id = $2",
            folder_id,
            owner_id,
        )
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| MediaError::NotFound(format!("Dossier files {folder_id}")))?;

        let rel = user_folder_dir(owner_id, &folder_path);
        let resolved = format!("{}/{}", base.trim_end_matches('/'), rel.to_string_lossy());

        sqlx::query_as!(
            MediaLibrary,
            r#"INSERT INTO media.libraries
               (owner_id, name, lib_type, path, icon, color, is_shared,
                source_type, files_folder_id, files_owner_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'files_folder',$8,$9)
               RETURNING id, owner_id, name, lib_type, path, icon, color,
                         is_shared, item_count, last_scan_at, scan_status,
                         scan_error, source_type, files_folder_id, files_owner_id,
                         created_at, updated_at"#,
            user.id,
            dto.name,
            dto.lib_type,
            resolved,
            dto.icon.as_deref().unwrap_or("🎵"),
            dto.color.as_deref().unwrap_or("#1a73e8"),
            dto.is_shared.unwrap_or(true),
            folder_id,
            owner_id,
        )
        .fetch_one(&state.db)
        .await?
    } else {
        let path = dto.path
            .filter(|p| !p.is_empty())
            .ok_or_else(|| MediaError::Validation("path requis pour source filesystem".into()))?;

        sqlx::query_as!(
            MediaLibrary,
            r#"INSERT INTO media.libraries (owner_id, name, lib_type, path, icon, color, is_shared)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               RETURNING id, owner_id, name, lib_type, path, icon, color,
                         is_shared, item_count, last_scan_at, scan_status,
                         scan_error, source_type, files_folder_id, files_owner_id,
                         created_at, updated_at"#,
            user.id,
            dto.name,
            dto.lib_type,
            path,
            dto.icon.as_deref().unwrap_or("🎬"),
            dto.color.as_deref().unwrap_or("#1a73e8"),
            dto.is_shared.unwrap_or(true),
        )
        .fetch_one(&state.db)
        .await?
    };

    Ok((StatusCode::CREATED, Json(json!(row))))
}

pub async fn update_library(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(dto): Json<UpdateLibraryDto>,
) -> Result<Json<Value>, MediaError> {
    if user.role != "admin" {
        return Err(MediaError::Forbidden);
    }
    let row = sqlx::query_as!(
        MediaLibrary,
        r#"UPDATE media.libraries
           SET name      = COALESCE($2, name),
               path      = COALESCE($3, path),
               icon      = COALESCE($4, icon),
               color     = COALESCE($5, color),
               is_shared = COALESCE($6, is_shared)
           WHERE id = $1
           RETURNING id, owner_id, name, lib_type, path, icon, color,
                     is_shared, item_count, last_scan_at, scan_status,
                     scan_error, source_type, files_folder_id, files_owner_id,
                     created_at, updated_at"#,
        id,
        dto.name,
        dto.path,
        dto.icon,
        dto.color,
        dto.is_shared,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| MediaError::NotFound(format!("Bibliothèque {id}")))?;
    Ok(Json(json!(row)))
}

/// Retourne les dossiers disponibles dans le module files (pour le picker de source).
/// Accessible aux admins uniquement (seuls les admins créent des bibliothèques).
pub async fn list_files_folders(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    if user.role != "admin" {
        return Err(MediaError::Forbidden);
    }
    let rows = sqlx::query!(
        r#"SELECT f.id, f.owner_id, f.path, f.name,
                  u.email        AS owner_email,
                  u.display_name AS owner_display_name
           FROM drive.folders f
           JOIN core.users u ON u.id = f.owner_id
           ORDER BY u.email, f.path"#
    )
    .fetch_all(&state.db)
    .await?;

    let folders: Vec<_> = rows.iter().map(|r| json!({
        "id":                 r.id,
        "owner_id":           r.owner_id,
        "path":               r.path,
        "name":               r.name,
        "owner_email":        r.owner_email,
        "owner_display_name": r.owner_display_name,
    })).collect();

    Ok(Json(json!({ "folders": folders })))
}

pub async fn delete_library(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, MediaError> {
    if user.role != "admin" {
        return Err(MediaError::Forbidden);
    }

    let mut tx = state.db.begin().await?;

    // Explicitly remove music tracks from this library (FK is SET NULL, not CASCADE)
    sqlx::query!("DELETE FROM media.tracks WHERE library_id = $1", id)
        .execute(&mut *tx)
        .await?;

    // Clean up albums from this library that have no remaining tracks
    sqlx::query!(
        r#"DELETE FROM media.albums
           WHERE library_id = $1
           AND id NOT IN (
               SELECT DISTINCT album_id FROM media.tracks WHERE album_id IS NOT NULL
           )"#,
        id
    )
    .execute(&mut *tx)
    .await?;

    // Clean up artists from this library that have no remaining tracks or albums
    sqlx::query!(
        r#"DELETE FROM media.artists
           WHERE library_id = $1
           AND id NOT IN (
               SELECT DISTINCT artist_id FROM media.tracks WHERE artist_id IS NOT NULL
               UNION
               SELECT DISTINCT artist_id FROM media.albums WHERE artist_id IS NOT NULL
           )"#,
        id
    )
    .execute(&mut *tx)
    .await?;

    // Delete the library; movies/shows/episodes cascade automatically
    sqlx::query!("DELETE FROM media.libraries WHERE id = $1", id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn start_scan(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    if user.role != "admin" {
        return Err(MediaError::Forbidden);
    }
    let lib = sqlx::query!(
        "SELECT path, lib_type FROM media.libraries WHERE id = $1",
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| MediaError::NotFound(format!("Bibliothèque {id}")))?;

    let db2       = state.db.clone();
    let settings2 = state.settings.clone();
    let path      = lib.path.clone();
    let lib_type  = lib.lib_type.clone();

    tokio::spawn(async move {
        if let Err(e) = scan::run_scan(&db2, &settings2, id, &path, &lib_type).await {
            tracing::error!(error = %e, library_id = %id, "Erreur scan");
        }
    });

    Ok(Json(json!({ "message": "Scan démarré", "library_id": id })))
}

pub async fn scan_all_libraries(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    if user.role != "admin" {
        return Err(MediaError::Forbidden);
    }
    let libs = sqlx::query!(
        "SELECT id, path, lib_type FROM media.libraries ORDER BY name"
    )
    .fetch_all(&state.db)
    .await?;

    let count = libs.len();

    for lib in libs {
        let db2       = state.db.clone();
        let settings2 = state.settings.clone();
        tokio::spawn(async move {
            if let Err(e) = scan::run_scan(&db2, &settings2, lib.id, &lib.path, &lib.lib_type).await {
                tracing::error!(error = %e, library_id = %lib.id, "Erreur scan-all");
            }
        });
    }

    Ok(Json(json!({ "message": "Scan démarré pour toutes les bibliothèques", "count": count })))
}

pub async fn scan_status(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let job = sqlx::query!(
        r#"SELECT status, files_found, files_processed, files_added, error_message
           FROM media.scan_jobs
           WHERE library_id = $1
           ORDER BY created_at DESC
           LIMIT 1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!(job.map(|j| json!({
        "status":           j.status,
        "files_found":      j.files_found,
        "files_processed":  j.files_processed,
        "files_added":      j.files_added,
        "error_message":    j.error_message,
    })).unwrap_or(json!({ "status": "idle" })))))
}
