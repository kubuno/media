//! Local album artwork priority: an image file in the album
//! folder (cover.jpg / folder.jpg / front.png…) beats embedded art, which
//! beats remote providers (Cover Art Archive, Deezer).
//!
//! Extracted/copied covers are cached as `<cache_path>/covers/<album_id>.jpg`
//! and served by `GET /albums/:id/cover` — `cover_path` then stores the
//! module-relative API path (`/api/v1/media/albums/<id>/cover`).

use std::path::{Path, PathBuf};
use uuid::Uuid;

const FOLDER_IMAGE_NAMES: &[&str] = &[
    "cover.jpg", "cover.jpeg", "cover.png",
    "folder.jpg", "folder.jpeg", "folder.png",
    "front.jpg", "front.jpeg", "front.png",
    "albumart.jpg", "albumart.png",
];

/// Where extracted covers live. The libraries cache path may sit outside the
/// module's writable sandbox (systemd ProtectSystem), so anchor the cache
/// next to the module's own storage directory instead.
pub fn covers_base(settings: &crate::config::Settings) -> PathBuf {
    let local = Path::new(&settings.storage.local_path);
    local
        .parent()
        .map(|p| p.join("covers"))
        .unwrap_or_else(|| Path::new(&settings.libraries.cache_path).join("covers"))
}

pub fn cached_cover_file(base: &Path, album_id: Uuid) -> PathBuf {
    base.join(format!("{album_id}.jpg"))
}

/// The API path stored in `albums.cover_path` for a locally-cached cover.
pub fn cover_api_path(album_id: Uuid) -> String {
    format!("/api/v1/media/albums/{album_id}/cover")
}

/// Find a conventional artwork image in the album folder (case-insensitive).
async fn find_folder_image(dir: &Path) -> Option<PathBuf> {
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    let mut found: Option<PathBuf> = None;
    let mut best_rank = usize::MAX;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if let Some(rank) = FOLDER_IMAGE_NAMES.iter().position(|n| *n == name) {
            if rank < best_rank {
                best_rank = rank;
                found = Some(entry.path());
            }
        }
    }
    found
}

/// Extract the embedded artwork (ID3 APIC / FLAC picture / MP4 covr) of an
/// audio file into `out` as JPEG. Returns false when the file has no art.
async fn extract_embedded(ffmpeg_bin: &str, audio_path: &Path, out: &Path) -> bool {
    let status = tokio::process::Command::new(ffmpeg_bin)
        .args(["-y", "-v", "quiet", "-i"])
        .arg(audio_path)
        .args(["-an", "-frames:v", "1"])
        .arg(out)
        .status()
        .await;
    matches!(status, Ok(s) if s.success()) && out.exists()
}

/// Resolve local artwork for an album from one of its track files:
/// folder image first, then embedded art. Returns the API path to store in
/// `cover_path`, or None when no local artwork exists.
pub async fn resolve_local_cover(
    ffmpeg_bin: &str,
    base:       &Path,
    album_id:   Uuid,
    track_path: &Path,
) -> Option<String> {
    let out = cached_cover_file(base, album_id);
    if out.exists() {
        return Some(cover_api_path(album_id));
    }
    if let Err(e) = tokio::fs::create_dir_all(base).await {
        tracing::warn!(error = %e, "Impossible de créer le cache des pochettes");
        return None;
    }

    // 1. Conventional image file next to the tracks (highest priority)
    if let Some(dir) = track_path.parent() {
        if let Some(img) = find_folder_image(dir).await {
            if tokio::fs::copy(&img, &out).await.is_ok() {
                tracing::info!(album = %album_id, source = %img.display(), "Pochette locale (fichier du dossier)");
                return Some(cover_api_path(album_id));
            }
        }
    }

    // 2. Embedded artwork in the audio file
    if extract_embedded(ffmpeg_bin, track_path, &out).await {
        tracing::info!(album = %album_id, source = %track_path.display(), "Pochette locale (art embarqué)");
        return Some(cover_api_path(album_id));
    }

    None
}
