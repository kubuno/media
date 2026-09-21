use axum::{extract::{Extension, State}, Json};
use kubuno_db::{dialect::Assign, params};
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

#[derive(sqlx::FromRow)]
struct SettingRow {
    setting_key: String,
    value:       String,
}

pub async fn get_settings(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    require_admin(&user)?;

    let rows = state.db.fetch_all_as::<SettingRow>(
        "SELECT setting_key, value FROM media.settings ORDER BY setting_key",
        params![],
    ).await?;

    let settings: serde_json::Map<String, Value> = rows
        .into_iter()
        .map(|r| (r.setting_key, Value::String(r.value)))
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

    // `updated_at` is engine-maintained (trigger / ON UPDATE), so the upsert
    // only ever sets `value`.
    let clause = state.db.backend().upsert(
        "media.settings",
        &["setting_key"],
        &[Assign::Incoming("value")],
    );

    if let Some(lang) = body.metadata_language {
        let sql = format!(
            "INSERT INTO media.settings (setting_key, value) VALUES ('metadata_language', $1){clause}"
        );
        state.db.execute(&sql, params![lang]).await?;
    }

    if let Some(key) = body.tmdb_api_key {
        let sql = format!(
            "INSERT INTO media.settings (setting_key, value) VALUES ('tmdb_api_key', $1){clause}"
        );
        state.db.execute(&sql, params![key.trim()]).await?;
    }

    if let Some(key) = body.omdb_api_key {
        let sql = format!(
            "INSERT INTO media.settings (setting_key, value) VALUES ('omdb_api_key', $1){clause}"
        );
        state.db.execute(&sql, params![key.trim()]).await?;
    }

    Ok(Json(json!({ "ok": true })))
}

// ── POST /media/admin/enrich ──────────────────────────────────────────────────
// Puts movies back from error_meta to pending_meta and (re)launches enrichment.
pub async fn trigger_enrich(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    require_admin(&user)?;

    // Only re-queue items that actually need it (failed or not-yet-enriched).
    // Never touch already-'ready' metadata — a full library re-enrichment is
    // unrequested and risks overwriting good metadata.
    let reset_movies = state.db.execute(
        "UPDATE media.movies SET meta_status = 'pending_meta' WHERE meta_status = 'error_meta'",
        params![],
    ).await?;

    let reset_shows = state.db.execute(
        "UPDATE media.tv_shows SET meta_status = 'pending_meta' WHERE meta_status = 'error_meta'",
        params![],
    ).await?;

    let reset_artists = state.db.execute(
        "UPDATE media.artists SET meta_status = 'pending_meta' WHERE meta_status = 'error_meta'",
        params![],
    ).await?;

    let reset_albums = state.db.execute(
        "UPDATE media.albums SET meta_status = 'pending_meta' WHERE meta_status = 'error_meta'",
        params![],
    ).await?;

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
