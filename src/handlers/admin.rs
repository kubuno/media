use axum::{extract::{Extension, State}, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{errors::MediaError, middleware::auth::AuthUser, state::AppState};

fn require_admin(user: &AuthUser) -> Result<(), MediaError> {
    if user.role != "admin" {
        return Err(MediaError::Forbidden);
    }
    Ok(())
}

// ── GET /media/admin/settings ─────────────────────────────────────────────────

pub async fn get_settings(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    require_admin(&user)?;

    let rows = sqlx::query!(
        "SELECT key, value FROM media.settings ORDER BY key"
    )
    .fetch_all(&state.db)
    .await?;

    let settings: serde_json::Map<String, Value> = rows
        .into_iter()
        .map(|r| (r.key, Value::String(r.value)))
        .collect();

    Ok(Json(Value::Object(settings)))
}

// ── PATCH /media/admin/settings ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PatchSettingsBody {
    pub metadata_language: Option<String>,
    /// Official TMDB API key (v3 key or v4 read token) — the primary
    /// movie/show metadata provider when set.
    pub tmdb_api_key:      Option<String>,
    /// OMDb API key — Rotten Tomatoes / IMDb / Metacritic ratings relay.
    pub omdb_api_key:      Option<String>,
}

pub async fn patch_settings(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<PatchSettingsBody>,
) -> Result<Json<Value>, MediaError> {
    require_admin(&user)?;

    if let Some(lang) = body.metadata_language {
        sqlx::query!(
            "INSERT INTO media.settings (key, value) VALUES ('metadata_language', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
            lang,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(key) = body.tmdb_api_key {
        sqlx::query!(
            "INSERT INTO media.settings (key, value) VALUES ('tmdb_api_key', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
            key.trim(),
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(key) = body.omdb_api_key {
        sqlx::query!(
            "INSERT INTO media.settings (key, value) VALUES ('omdb_api_key', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
            key.trim(),
        )
        .execute(&state.db)
        .await?;
    }

    Ok(Json(json!({ "ok": true })))
}

// ── POST /media/admin/enrich ──────────────────────────────────────────────────
// Remet les films en error_meta → pending_meta et lance l'enrichissement.
pub async fn trigger_enrich(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    require_admin(&user)?;

    // Only re-queue items that actually need it (failed or not-yet-enriched).
    // Never touch already-'ready' metadata — a full library re-enrichment is
    // unrequested and risks overwriting good metadata.
    let reset_movies = sqlx::query(
        "UPDATE media.movies SET meta_status = 'pending_meta'
         WHERE meta_status = 'error_meta'",
    )
    .execute(&state.db)
    .await?
    .rows_affected();

    let reset_shows = sqlx::query(
        "UPDATE media.tv_shows SET meta_status = 'pending_meta'
         WHERE meta_status = 'error_meta'",
    )
    .execute(&state.db)
    .await?
    .rows_affected();

    let reset_artists = sqlx::query(
        "UPDATE media.artists SET meta_status = 'pending_meta'
         WHERE meta_status = 'error_meta'",
    )
    .execute(&state.db)
    .await?
    .rows_affected();

    let reset_albums = sqlx::query(
        "UPDATE media.albums SET meta_status = 'pending_meta'
         WHERE meta_status = 'error_meta'",
    )
    .execute(&state.db)
    .await?
    .rows_affected();

    let count = reset_movies + reset_shows + reset_artists + reset_albums;

    let db2  = state.db.clone();
    let s2   = state.settings.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::workers::metadata::enrich_pending(&db2, &s2).await {
            tracing::error!(error = %e, "Erreur enrichissement films");
        }
        if let Err(e) = crate::workers::metadata::enrich_pending_shows(&db2, &s2).await {
            tracing::error!(error = %e, "Erreur enrichissement séries");
        }
        if let Err(e) = crate::workers::metadata::enrich_pending_artists(&db2, &s2).await {
            tracing::error!(error = %e, "Erreur enrichissement artistes");
        }
        if let Err(e) = crate::workers::metadata::enrich_pending_albums(&db2, &s2).await {
            tracing::error!(error = %e, "Erreur enrichissement albums");
        }
    });

    Ok(Json(json!({
        "ok":    true,
        "queued": count,
        "message": format!("{count} média(s) remis en file d'enrichissement")
    })))
}
