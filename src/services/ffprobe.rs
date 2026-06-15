use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Default)]
pub struct MediaInfo {
    pub duration_secs: i32,
    pub video_codec:   Option<String>,
    pub audio_codec:   Option<String>,
    pub width:         Option<i32>,
    pub height:        Option<i32>,
    pub bitrate:       Option<i32>,
    pub sample_rate:   Option<i32>,
    pub channels:      Option<i32>,
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Vec<FfprobeStream>,
    format:  FfprobeFormat,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type:  Option<String>,
    codec_name:  Option<String>,
    width:       Option<i32>,
    height:      Option<i32>,
    sample_rate: Option<String>,
    channels:    Option<i32>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
    bit_rate: Option<String>,
}

pub async fn probe(ffprobe_bin: &str, path: &str) -> Result<MediaInfo> {
    let output = tokio::process::Command::new(ffprobe_bin)
        .args([
            "-v",          "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            path,
        ])
        .output()
        .await
        .with_context(|| format!("ffprobe introuvable: {ffprobe_bin}"))?;

    if !output.status.success() {
        anyhow::bail!("ffprobe erreur pour: {path}");
    }

    let data: FfprobeOutput = serde_json::from_slice(&output.stdout)
        .context("Parsing sortie ffprobe")?;

    let duration_secs = data.format.duration
        .as_deref()
        .and_then(|d| d.parse::<f64>().ok())
        .map(|d| d as i32)
        .unwrap_or(0);

    let bitrate = data.format.bit_rate
        .as_deref()
        .and_then(|b| b.parse::<i32>().ok())
        .map(|b| b / 1000);

    let mut info = MediaInfo {
        duration_secs,
        bitrate,
        ..Default::default()
    };

    for stream in &data.streams {
        match stream.codec_type.as_deref() {
            Some("video") if info.video_codec.is_none() => {
                info.video_codec = stream.codec_name.clone();
                info.width       = stream.width;
                info.height      = stream.height;
            }
            Some("audio") if info.audio_codec.is_none() => {
                info.audio_codec = stream.codec_name.clone();
                info.sample_rate = stream.sample_rate
                    .as_deref()
                    .and_then(|s| s.parse().ok());
                info.channels    = stream.channels;
            }
            _ => {}
        }
    }

    Ok(info)
}

pub fn is_available(ffprobe_bin: &str) -> bool {
    std::process::Command::new(ffprobe_bin)
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
