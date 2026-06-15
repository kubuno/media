use anyhow::Result;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use sqlx::PgPool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::config::Settings;
use super::scan;

/// Lance le watcher filesystem pour toutes les bibliothèques actives.
/// Recharge la liste des bibliothèques toutes les 5 minutes pour
/// prendre en compte les ajouts/suppressions.
pub async fn start(db: PgPool, settings: Arc<Settings>) {
    tokio::spawn(async move {
        loop {
            if let Err(e) = run_watch_cycle(&db, &settings).await {
                tracing::error!(error = %e, "Watcher filesystem erreur, redémarrage dans 60s");
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        }
    });
}

async fn run_watch_cycle(db: &PgPool, settings: &Arc<Settings>) -> Result<()> {
    // Charger les bibliothèques
    let libs = sqlx::query!(
        "SELECT id, path, lib_type FROM media.libraries ORDER BY created_at"
    )
    .fetch_all(db)
    .await?;

    if libs.is_empty() {
        tokio::time::sleep(Duration::from_secs(60)).await;
        return Ok(());
    }

    // Map chemin → (library_id, lib_type) pour retrouver la bib depuis un événement
    let mut path_to_lib: HashMap<PathBuf, (Uuid, String)> = HashMap::new();
    for lib in &libs {
        path_to_lib.insert(PathBuf::from(&lib.path), (lib.id, lib.lib_type.clone()));
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<Event>();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default().with_poll_interval(Duration::from_secs(5)),
    )?;

    for lib in &libs {
        let p = PathBuf::from(&lib.path);
        if p.exists() {
            watcher.watch(&p, RecursiveMode::Recursive)?;
            tracing::info!(path = %lib.path, lib_type = %lib.lib_type, "Surveillance du dossier activée");

            // Scan initial : indexe les fichiers déjà présents non encore en base
            let db2       = db.clone();
            let settings2 = settings.clone();
            let lib_id    = lib.id;
            let lib_path  = lib.path.clone();
            let lib_type  = lib.lib_type.clone();
            tokio::spawn(async move {
                if let Err(e) = scan::run_scan(&db2, &settings2, lib_id, &lib_path, &lib_type).await {
                    tracing::error!(error = %e, path = %lib_path, "Erreur scan initial au démarrage du watcher");
                }
            });
        } else {
            tracing::warn!(path = %lib.path, "Dossier de bibliothèque introuvable, watcher ignoré");
        }
    }

    // Recharger les bibliothèques toutes les 5 min (nouveau watcher)
    let reload_at = tokio::time::Instant::now() + Duration::from_secs(300);

    loop {
        tokio::select! {
            Some(event) = rx.recv() => {
                handle_event(event, &path_to_lib, db, settings).await;
            }
            _ = tokio::time::sleep_until(reload_at) => {
                // Redémarrer le cycle pour prendre en compte de nouvelles bibliothèques
                return Ok(());
            }
        }
    }
}

async fn handle_event(
    event: Event,
    path_to_lib: &HashMap<PathBuf, (Uuid, String)>,
    db: &PgPool,
    settings: &Arc<Settings>,
) {
    match event.kind {
        EventKind::Create(_) | EventKind::Modify(notify::event::ModifyKind::Name(_)) => {}
        _ => return,
    }

    for path in &event.paths {
        if !path.is_file() {
            continue;
        }

        // Trouver la bibliothèque parente
        let (lib_id, lib_type) = match find_parent_lib(path, path_to_lib) {
            Some(v) => v,
            None => continue,
        };

        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let is_video = settings.scan.video_extensions.iter()
            .any(|e| e.eq_ignore_ascii_case(&ext));
        let is_audio = settings.scan.audio_extensions.iter()
            .any(|e| e.eq_ignore_ascii_case(&ext));

        if !is_video && !is_audio {
            continue;
        }

        let file_path = path.to_string_lossy().to_string();
        tracing::info!(path = %file_path, lib_type, "Nouveau fichier détecté par le watcher");

        // Lancer un mini-scan (juste ce fichier) dans un thread séparé
        let db2       = db.clone();
        let settings2 = settings.clone();
        let fp        = file_path.clone();
        let lt        = lib_type.to_string();

        tokio::spawn(async move {
            if let Err(e) = scan::index_single_file(&db2, &settings2, lib_id, &fp, &lt).await {
                tracing::error!(error = %e, path = %fp, "Erreur indexation fichier");
            }
        });
    }
}

fn find_parent_lib<'a>(
    path: &std::path::Path,
    path_to_lib: &'a HashMap<PathBuf, (Uuid, String)>,
) -> Option<(Uuid, &'a str)> {
    let mut current = path.parent()?;
    loop {
        if let Some((id, lt)) = path_to_lib.get(current) {
            return Some((*id, lt.as_str()));
        }
        match current.parent() {
            Some(p) => current = p,
            None    => return None,
        }
    }
}
