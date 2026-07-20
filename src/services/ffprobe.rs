use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;

/// Embedded tags (ID3 / Vorbis comments / MP4 atoms) read by ffprobe.
/// These are far more reliable than guessing from the file path.
#[derive(Debug, Default, Clone)]
pub struct MediaTags {
    pub title:        Option<String>,
    pub artist:       Option<String>,
    pub album_artist: Option<String>,
    pub album:        Option<String>,
    pub track_number: Option<i32>,
    pub disc_number:  Option<i32>,
    pub year:         Option<i32>,
    pub genre:        Option<String>,
    pub composer:     Option<String>,
    pub lyricist:     Option<String>,
}

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
    pub tags:          MediaTags,
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
    tags:        Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
    bit_rate: Option<String>,
    tags:     Option<HashMap<String, String>>,
}

/// "3/12" or "3" → 3
fn parse_track_no(s: &str) -> Option<i32> {
    s.split('/').next()?.trim().parse().ok()
}

/// "2021-05-01", "2021" → 2021
fn parse_year(s: &str) -> Option<i32> {
    let y: i32 = s.get(..4)?.parse().ok()?;
    (1000..=2999).contains(&y).then_some(y)
}

/// Merge format-level and stream-level tags into a case-insensitive map,
/// then extract the fields we care about. Ogg/Opus put tags on the stream,
/// MP3/FLAC/M4A on the format — we accept both.
fn extract_tags(data: &FfprobeOutput) -> MediaTags {
    let mut map: HashMap<String, String> = HashMap::new();
    // Stream tags first so format tags (usually authoritative) win on conflict.
    for stream in &data.streams {
        if let Some(tags) = &stream.tags {
            for (k, v) in tags {
                map.insert(k.to_ascii_lowercase(), v.clone());
            }
        }
    }
    if let Some(tags) = &data.format.tags {
        for (k, v) in tags {
            map.insert(k.to_ascii_lowercase(), v.clone());
        }
    }

    let get = |keys: &[&str]| -> Option<String> {
        keys.iter()
            .find_map(|k| map.get(*k))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };

    MediaTags {
        title:        get(&["title"]),
        artist:       get(&["artist"]),
        album_artist: get(&["album_artist", "albumartist", "album artist"]),
        album:        get(&["album"]),
        track_number: get(&["track", "tracknumber"]).as_deref().and_then(parse_track_no),
        disc_number:  get(&["disc", "discnumber"]).as_deref().and_then(parse_track_no),
        year:         get(&["date", "year", "originaldate", "originalyear"])
            .as_deref()
            .and_then(parse_year),
        genre:        get(&["genre"]),
        composer:     get(&["composer"]),
        lyricist:     get(&["lyricist", "text"]),
    }
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
        tags: extract_tags(&data),
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
