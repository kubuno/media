use axum::{
    body::Body,
    extract::{Extension, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::io::SeekFrom;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    services::{ffmpeg, hls},
    state::AppState,
};

/// Génère ou renvoie la playlist HLS maître pour un item (film ou épisode).
pub async fn master_playlist(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(item_id): Path<Uuid>,
) -> Result<Response, MediaError> {
    if !ffmpeg::is_available(&state.settings.transcoding.ffmpeg_bin) {
        return Err(MediaError::Ffmpeg("FFmpeg non disponible".into()));
    }
    let profiles = ["1080p", "720p", "480p"];
    let body = ffmpeg::generate_master_playlist(&item_id.to_string(), &profiles);
    Ok((
        [(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")],
        body,
    ).into_response())
}

/// Renvoie la playlist M3U8 d'une qualité, démarrant la transcription si nécessaire.
pub async fn quality_playlist(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path((item_id, quality)): Path<(Uuid, String)>,
) -> Result<Response, MediaError> {
    let cache = &state.settings.libraries.cache_path;
    let playlist_path = hls::playlist_path(cache, &item_id.to_string(), &quality);

    if !playlist_path.exists() {
        let file_path: Option<String> = sqlx::query_scalar!(
            "SELECT file_path FROM media.movies WHERE id = $1",
            item_id
        )
        .fetch_optional(&state.db)
        .await?;

        let Some(src) = file_path else {
            return Err(MediaError::NotFound(format!("Item {item_id}")));
        };

        let output_dir = hls::output_dir(cache, &item_id.to_string(), &quality);

        let profile = ffmpeg::TranscodeProfile {
            name:               quality.clone(),
            width:              1920,
            height:             1080,
            video_codec:        state.settings.transcoding.video_codec.clone(),
            crf:                23,
            video_bitrate_kbps: 8000,
        };

        tokio::spawn(async move {
            if let Err(e) = ffmpeg::transcode_hls(
                "ffmpeg",
                &src,
                &output_dir,
                &profile,
                0,
            ).await {
                tracing::error!(error = %e, "Transcription HLS échouée");
            }
        });

        let mut headers = HeaderMap::new();
        headers.insert("Retry-After", HeaderValue::from_static("5"));
        return Ok((StatusCode::ACCEPTED, headers, Json(json!({ "status": "transcoding" }))).into_response());
    }

    serve_file(&playlist_path, "application/vnd.apple.mpegurl").await
}

/// Renvoie un segment HLS (.ts).
pub async fn hls_segment(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path((item_id, quality, seg)): Path<(Uuid, String, u32)>,
) -> Result<Response, MediaError> {
    let cache = &state.settings.libraries.cache_path;
    let seg_path = hls::segment_path(cache, &item_id.to_string(), &quality, seg);

    if !seg_path.exists() {
        return Err(MediaError::NotFound(format!("Segment {item_id}/{quality}/{seg}")));
    }

    serve_file(&seg_path, "video/mp2t").await
}

/// Stream direct sans transcription — supporte les Range requests pour la navigation.
pub async fn direct_stream(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(item_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, MediaError> {
    let file_path: Option<String> = sqlx::query_scalar!(
        "SELECT file_path FROM media.movies WHERE id = $1",
        item_id
    )
    .fetch_optional(&state.db)
    .await?;

    let path = file_path
        .ok_or_else(|| MediaError::NotFound(format!("Film {item_id}")))?;

    let range = range_header(&headers);
    serve_ranged(std::path::Path::new(&path), "video/mp4", range.as_deref()).await
}

/// Stream audio — supporte les Range requests pour la navigation.
pub async fn audio_stream(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Path(track_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, MediaError> {
    let file_path: Option<String> = sqlx::query_scalar!(
        "SELECT file_path FROM media.tracks WHERE id = $1",
        track_id
    )
    .fetch_optional(&state.db)
    .await?;

    let path = file_path
        .ok_or_else(|| MediaError::NotFound(format!("Piste {track_id}")))?;

    let content_type = guess_audio_mime(&path);
    let range = range_header(&headers);
    serve_ranged(std::path::Path::new(&path), content_type, range.as_deref()).await
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extrait la valeur brute du header Range s'il est présent.
fn range_header(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

/// Sert un fichier avec support des Range requests (206 Partial Content).
/// Inclut toujours `Accept-Ranges: bytes` pour signaler au navigateur que
/// la navigation dans le fichier est possible.
async fn serve_ranged(
    path: &std::path::Path,
    content_type: &str,
    range: Option<&str>,
) -> Result<Response, MediaError> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| MediaError::Storage(e.to_string()))?;

    let file_size = file
        .metadata()
        .await
        .map_err(|e| MediaError::Storage(e.to_string()))?
        .len();

    let ct = HeaderValue::from_str(content_type)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));

    if let Some(range_str) = range {
        if let Some((start, end)) = parse_range(range_str, file_size) {
            let length = end - start + 1;

            file.seek(SeekFrom::Start(start))
                .await
                .map_err(|e| MediaError::Storage(e.to_string()))?;

            let stream = ReaderStream::new(file.take(length));
            let body   = Body::from_stream(stream);

            return Ok((
                StatusCode::PARTIAL_CONTENT,
                [
                    (header::CONTENT_TYPE,   ct),
                    (header::CONTENT_RANGE,  HeaderValue::from_str(
                        &format!("bytes {start}-{end}/{file_size}")
                    ).unwrap_or_else(|_| HeaderValue::from_static("bytes 0-0/0"))),
                    (header::CONTENT_LENGTH, HeaderValue::from_str(&length.to_string())
                        .unwrap_or_else(|_| HeaderValue::from_static("0"))),
                    (header::ACCEPT_RANGES,  HeaderValue::from_static("bytes")),
                ],
                body,
            ).into_response());
        }
    }

    // Full-file response — advertise range support so the browser knows it can seek.
    let stream = ReaderStream::new(file);
    let body   = Body::from_stream(stream);

    Ok((
        [
            (header::CONTENT_TYPE,   ct),
            (header::CONTENT_LENGTH, HeaderValue::from_str(&file_size.to_string())
                .unwrap_or_else(|_| HeaderValue::from_static("0"))),
            (header::ACCEPT_RANGES,  HeaderValue::from_static("bytes")),
        ],
        body,
    ).into_response())
}

/// Sert un fichier sans support Range (pour les playlists HLS et segments).
async fn serve_file(path: &std::path::Path, content_type: &str) -> Result<Response, MediaError> {
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| MediaError::Storage(e.to_string()))?;

    let stream = ReaderStream::new(file);
    let body   = Body::from_stream(stream);

    Ok((
        [(header::CONTENT_TYPE, content_type)],
        body,
    ).into_response())
}

/// Parse un header `Range: bytes=start-end` ou `Range: bytes=start-`.
fn parse_range(range_str: &str, file_size: u64) -> Option<(u64, u64)> {
    let s = range_str.strip_prefix("bytes=")?;
    let mut it = s.splitn(2, '-');
    let start: u64 = it.next()?.trim().parse().ok()?;
    let end: u64 = match it.next() {
        Some(e) if !e.trim().is_empty() => e.trim().parse().ok()?,
        _ => file_size.saturating_sub(1),
    };
    if start > end || end >= file_size {
        return None;
    }
    Some((start, end))
}

fn guess_audio_mime(path: &str) -> &'static str {
    match std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("mp3")  => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("ogg")  => "audio/ogg",
        Some("opus") => "audio/opus",
        Some("m4a")  => "audio/mp4",
        Some("aac")  => "audio/aac",
        Some("wav")  => "audio/wav",
        _            => "application/octet-stream",
    }
}
