use anyhow::{Context, Result};
use std::path::Path;

pub struct TranscodeProfile {
    pub name:             String,
    pub width:            u32,
    pub height:           u32,
    pub video_codec:      String,
    pub crf:              u32,
    pub video_bitrate_kbps: u32,
}

pub struct ThumbnailSprite {
    pub path:           String,
    pub interval_secs:  u64,
    pub tile_width:     u32,
    pub tile_height:    u32,
    pub cols:           u32,
    pub rows:           u32,
}

pub fn is_available(ffmpeg_bin: &str) -> bool {
    std::process::Command::new(ffmpeg_bin)
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub async fn transcode_hls(
    ffmpeg_bin:  &str,
    input_path:  &str,
    output_dir:  &Path,
    profile:     &TranscodeProfile,
    start_secs:  u64,
) -> Result<tokio::process::Child> {
    tokio::fs::create_dir_all(output_dir)
        .await
        .context("Création dossier HLS")?;

    let vf = format!(
        "scale={}:{}:force_original_aspect_ratio=decrease,\
         pad={}:{}:(ow-iw)/2:(oh-ih)/2",
        profile.width, profile.height,
        profile.width, profile.height,
    );

    let seg_path = output_dir.join("seg%05d.ts");
    let pls_path = output_dir.join("playlist.m3u8");

    let child = tokio::process::Command::new(ffmpeg_bin)
        .args([
            "-hide_banner",
            "-loglevel",    "warning",
            "-ss",          &start_secs.to_string(),
            "-i",           input_path,
            "-c:v",         &profile.video_codec,
            "-crf",         &profile.crf.to_string(),
            "-preset",      "fast",
            "-profile:v",   "high",
            "-level",       "4.1",
            "-pix_fmt",     "yuv420p",
            "-vf",          &vf,
            "-c:a",         "aac",
            "-b:a",         "192k",
            "-ac",          "2",
            "-hls_time",    "6",
            "-hls_playlist_type", "event",
            "-hls_segment_filename",
                            seg_path.to_str().unwrap(),
            "-start_number", "0",
            pls_path.to_str().unwrap(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("Démarrage FFmpeg")?;

    Ok(child)
}

pub async fn generate_thumbnail_sprites(
    ffmpeg_bin:    &str,
    input_path:    &str,
    output_path:   &Path,
    duration_secs: u64,
) -> Result<ThumbnailSprite> {
    let interval = (duration_secs / 100).max(1);
    let vf = format!("fps=1/{},scale=160:-1,tile=10x10", interval);

    let status = tokio::process::Command::new(ffmpeg_bin)
        .args([
            "-hide_banner",
            "-loglevel", "warning",
            "-i", input_path,
            "-vf", &vf,
            "-frames:v", "1",
            "-q:v", "5",
            output_path.to_str().unwrap(),
        ])
        .status()
        .await
        .context("FFmpeg sprites")?;

    if !status.success() {
        anyhow::bail!("FFmpeg sprites échec pour: {input_path}");
    }

    Ok(ThumbnailSprite {
        path:          output_path.to_string_lossy().to_string(),
        interval_secs: interval,
        tile_width:    160,
        tile_height:   90,
        cols:          10,
        rows:          10,
    })
}

pub fn generate_master_playlist(item_id: &str, profiles: &[&str]) -> String {
    let mut m3u8 = "#EXTM3U\n#EXT-X-VERSION:3\n\n".to_string();
    for name in profiles {
        m3u8.push_str(&format!(
            "#EXT-X-STREAM-INF:CODECS=\"avc1.640028,mp4a.40.2\"\n\
             /api/v1/media/stream/{}/hls/{}/playlist.m3u8\n\n",
            item_id,
            name.to_lowercase()
        ));
    }
    m3u8
}
