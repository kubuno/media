use anyhow::{Context, Result};
use clap::Parser;
use kubuno_db::{params, DbPool};
use kubuno_media::{config::Settings, router, state::AppState, workers, SCHEMA};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

// ── Lecture de module.toml ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct Manifest {
    module:        ManifestModule,
    #[serde(default)]
    sidebar_items: Vec<SidebarItemRaw>,
    events:        Option<ManifestEvents>,
    /// Declarative instance settings, stored by the core and read back through
    /// `/internal/modules/media/settings`. The metadata provider KEYS are not
    /// here: being secrets, they stay in the module's own `media.settings`
    /// table behind a custom admin section.
    #[serde(default)]
    settings:      Vec<SettingDefRaw>,
    /// Pages the admin panel is split into (`[[setting_groups]]`). Each becomes
    /// an entry of the admin menu with its own address.
    #[serde(default)]
    setting_groups: Vec<SettingGroupRaw>,
}

/// One `[[setting_groups]]` entry of module.toml, forwarded verbatim. `id` is a
/// STABLE, UNTRANSLATED slug: it travels in the URL of the admin page.
#[derive(Deserialize, Serialize)]
struct SettingGroupRaw {
    id:          String,
    label:       String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon:        Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    position:    Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

/// One `[[settings]]` entry (declarative scalar), forwarded verbatim to the core
/// so the console can render its form.
#[derive(Deserialize, Serialize)]
struct SettingDefRaw {
    key:         String,
    scope:       String,
    #[serde(rename = "type")]
    value_type:  String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    values:      Option<Value>,
    default:     Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    label:       Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    category:    Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    group:       Option<String>,
    #[serde(default)]
    public:      bool,
}

#[derive(Deserialize)]
struct ManifestModule {
    #[allow(dead_code)]
    id:            String,
    display_name:  String,
    description:   Option<String>,
    settings_path: Option<String>,
}

#[derive(Deserialize)]
struct SidebarItemRaw {
    id:       String,
    label:    String,
    icon:     String,
    path:     String,
    position: i32,
}

#[derive(Deserialize)]
struct ManifestEvents {
    #[serde(default)]
    subscribed: Vec<String>,
}

fn load_manifest() -> Option<Manifest> {
    let path = if let Ok(dir) = std::env::var("KUBUNO_MODULE_DIR") {
        std::path::PathBuf::from(dir).join("module.toml")
    } else {
        std::env::current_exe().ok()?.parent()?.join("module.toml")
    };

    let content = std::fs::read_to_string(&path)
        .map_err(|e| tracing::warn!(path = %path.display(), error = %e, "module.toml introuvable"))
        .ok()?;

    toml::from_str::<Manifest>(&content)
        .map_err(|e| tracing::error!(path = %path.display(), error = %e, "module.toml invalide"))
        .ok()
}

// ── CLI ───────────────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
#[command(name = "kubuno-media", version, about = "Module média Kubuno")]
struct Cli {
    #[arg(short, long, env = "KM_CONFIG_FILE")]
    config: Option<String>,
}

// ── Point d'entrée ────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    let _cli = Cli::parse();

    let settings = Settings::load().context("Chargement de la configuration")?;

    let log_level = settings.logging.level.clone();
    let subscriber = tracing_subscriber::fmt().with_env_filter(
        tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(&log_level)),
    );

    match settings.logging.format {
        kubuno_media::config::LogFormat::Json   => subscriber.json().init(),
        kubuno_media::config::LogFormat::Pretty => subscriber.init(),
    }

    tracing::info!("Kubuno Media v{} démarrage…", env!("CARGO_PKG_VERSION"));

    // Database pool. The engine (PostgreSQL / MySQL / SQLite) is the
    // administrator's choice in `[database] engine`, read at run time; `connect`
    // also creates the module's namespace (PostgreSQL schema, MySQL database, or
    // the ATTACHed SQLite file).
    let pool = kubuno_db::connect(&settings.database, SCHEMA)
        .await
        .context("Connexion à la base de données")?;

    // Migrations: the set for the pool's engine, kept inside the module's own
    // namespace.
    if settings.database.run_migrations {
        kubuno_db::migrations!(
            "./migrations/postgres",
            "./migrations/mysql",
            "./migrations/sqlite",
        )
        .run(&pool, SCHEMA)
        .await
        .context("Migrations")?;

        // Synchronise the builtin web-radio catalogue (idempotent upsert by slug).
        kubuno_media::services::radio_catalog::seed(&pool).await;
        // Synchronise the builtin web-TV catalogue (idempotent upsert by slug).
        kubuno_media::services::tv_catalog::seed(&pool).await;
    }

    let http = Client::new();

    let storage = kubuno_storage::LocalStorage::new(&settings.storage.local_path)
        .await
        .context("Initialisation du stockage local")?;

    // Instance settings: compiled defaults, then one read from the core so the
    // parental control and the re-scan cycle start with the administrator's
    // values rather than with the defaults for the first minute.
    let instance = Arc::new(std::sync::RwLock::new(
        kubuno_media::config::instance::InstanceConfig::default(),
    ));
    if let Some(cfg) = kubuno_media::config::instance::fetch(
        &http, &settings.core.url, &settings.core.internal_secret,
    ).await {
        if let Ok(mut w) = instance.write() { *w = cfg; }
    }

    let state = AppState {
        db:       pool,
        settings: Arc::new(settings.clone()),
        storage:  Arc::new(storage),
        http:     http.clone(),
        instance: instance.clone(),
    };

    // Instance-settings refresher: an admin edit takes effect within a minute,
    // no restart. A failed read keeps the last good values.
    {
        let http_r     = http.clone();
        let settings_r = settings.clone();
        let instance_r = instance.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                if let Some(cfg) = kubuno_media::config::instance::fetch(
                    &http_r, &settings_r.core.url, &settings_r.core.internal_secret,
                ).await {
                    if let Ok(mut w) = instance_r.write() { *w = cfg; }
                }
            }
        });
    }

    // Worker metadata TMDB (tourne en continu, traite les pending_meta)
    workers::metadata::start(state.db.clone(), state.settings.clone()).await;

    // Scan de démarrage + watcher filesystem
    if settings.scan.watch_filesystem {
        // Scan au démarrage pour détecter les fichiers ajoutés pendant l'arrêt
        {
            let db2  = state.db.clone();
            let s2   = state.settings.clone();
            tokio::spawn(async move {
                startup_scan(&db2, &s2).await;
            });
        }
        // Watcher pour les nouveaux fichiers en temps réel. Il reçoit l'AppState
        // entier pour relire l'intervalle de ré-analyse à chaque cycle.
        workers::watcher::start(state.clone()).await;
    }

    // Enregistrement auprès du core (avec retry infini)
    register_with_core(&http, &settings).await;

    // Heartbeat toutes les 30s
    {
        let http2     = http.clone();
        let settings2 = settings.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;
                let url    = format!("{}/internal/modules/media/heartbeat", settings2.core.url);
                let secret = &settings2.core.internal_secret;
                match http2.post(&url).header("X-Internal-Secret", secret.as_str()).send().await {
                    Ok(r) if r.status().is_success() => {}
                    Ok(r) if r.status() == reqwest::StatusCode::NOT_FOUND => {
                        tracing::info!("Heartbeat 404 — ré-enregistrement…");
                        register_with_core(&http2, &settings2).await;
                    }
                    Ok(r) if r.status() == reqwest::StatusCode::FORBIDDEN => {
                        tracing::info!("Heartbeat 403 — module désactivé, attente…");
                    }
                    Ok(r)  => tracing::warn!(status = %r.status(), "Heartbeat réponse inattendue"),
                    Err(e) => tracing::warn!(error = %e, "Heartbeat erreur réseau"),
                }
            }
        });
    }

    // Serveur HTTP
    let addr = format!("{}:{}", settings.server.host, settings.server.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("Bind sur {addr}"))?;

    tracing::info!("Kubuno Media démarré sur http://{addr}");

    let app = router::build(state);
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .await
        .context("Erreur du serveur HTTP")?;

    Ok(())
}

/// Scan rapide au démarrage : parcourt chaque bibliothèque et indexe
/// les fichiers non encore présents en DB.
async fn startup_scan(db: &DbPool, settings: &Arc<Settings>) {
    #[derive(sqlx::FromRow)]
    struct LibRow {
        id:       uuid::Uuid,
        path:     String,
        lib_type: String,
    }
    let libs = match db
        .fetch_all_as::<LibRow>(
            "SELECT id, path, lib_type FROM media.libraries ORDER BY created_at",
            params![],
        )
        .await
    {
        Ok(rows) => rows,
        Err(e) => { tracing::error!(error = %e, "startup_scan: lecture bibliothèques"); return; }
    };

    for lib in libs {
        tracing::info!(path = %lib.path, lib_type = %lib.lib_type, "Scan de démarrage…");
        if let Err(e) = kubuno_media::workers::scan::run_scan(
            db, settings, lib.id, &lib.path, &lib.lib_type,
        ).await {
            tracing::error!(error = %e, path = %lib.path, "Erreur scan de démarrage");
        }
    }
}

fn backoff(attempt: u32) -> u64 {
    if attempt <= 10 { (attempt * 2) as u64 } else { 30 }
}

async fn register_with_core(http: &Client, settings: &Settings) {
    let base_url = format!("http://{}:{}", settings.server.host, settings.server.port);
    let core_url = &settings.core.url;
    let secret   = &settings.core.internal_secret;

    let manifest = load_manifest();
    let display_name  = manifest.as_ref().map(|m| m.module.display_name.as_str()).unwrap_or("Médias").to_string();
    let description   = manifest.as_ref().and_then(|m| m.module.description.clone());
    let settings_path = manifest.as_ref().and_then(|m| m.module.settings_path.clone());
    let sidebar_items: Vec<Value> = manifest.as_ref()
        .map(|m| m.sidebar_items.iter().map(|s| json!({
            "id":       s.id,
            "label":    s.label,
            "icon":     s.icon,
            "path":     s.path,
            "position": s.position,
        })).collect())
        .unwrap_or_else(|| vec![
            json!({ "id": "media-watch",  "label": "Regarder", "icon": "Tv",    "path": "/media/watch",  "position": 45 }),
            json!({ "id": "media-listen", "label": "Écouter",  "icon": "Music", "path": "/media/listen", "position": 46 }),
        ]);
    let subscribed_events: Vec<String> = manifest.as_ref()
        .and_then(|m| m.events.as_ref())
        .map(|e| e.subscribed.clone())
        .unwrap_or_else(|| vec!["UserDeleted".into()]);

    let settings_schema: Value = manifest.as_ref()
        .map(|m| serde_json::to_value(&m.settings).unwrap_or_else(|_| json!([])))
        .unwrap_or_else(|| json!([]));
    let setting_groups: Value = manifest.as_ref()
        .map(|m| serde_json::to_value(&m.setting_groups).unwrap_or_else(|_| json!([])))
        .unwrap_or_else(|| json!([]));

    let payload = json!({
        "module_id":         "media",
        "display_name":      display_name,
        "description":       description,
        "settings_path":     settings_path,
        "settings_schema":   settings_schema,
        "setting_groups":    setting_groups,
        "base_url":          base_url,
        "version":           env!("CARGO_PKG_VERSION"),
        "routes":            [{ "method": "*", "path": "/*" }],
        "sidebar_items":     sidebar_items,
        "subscribed_events": subscribed_events,
    });

    for attempt in 1u32.. {
        let url = format!("{core_url}/internal/modules/register");
        match http.post(&url)
            .header("X-Internal-Secret", secret.as_str())
            .json(&payload)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                tracing::info!("Module media enregistré auprès du core");
                return;
            }
            Ok(resp) if resp.status() == reqwest::StatusCode::FORBIDDEN => {
                tracing::info!(attempt, "Module désactivé par l'admin, nouvel essai dans 30s…");
                tokio::time::sleep(Duration::from_secs(30)).await;
                continue;
            }
            Ok(resp) => {
                let wait = backoff(attempt);
                tracing::warn!(attempt, status = %resp.status(), "Enregistrement échoué, retry dans {wait}s…");
                tokio::time::sleep(Duration::from_secs(wait)).await;
            }
            Err(e) => {
                let wait = backoff(attempt);
                tracing::warn!(attempt, error = %e, "Core inaccessible, retry dans {wait}s…");
                tokio::time::sleep(Duration::from_secs(wait)).await;
            }
        }
    }
    unreachable!()
}
