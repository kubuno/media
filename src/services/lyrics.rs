//! Free, key-less online lyrics providers. Tried in order until one returns a
//! match. LRCLIB additionally yields time-synced (LRC) lyrics for karaoke mode.

use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

/// A resolved set of lyrics, with provenance for crediting the source.
pub struct Lyrics {
    pub text:   String,
    /// True when `text` is LRC (contains `[mm:ss.xx]` timestamps).
    pub synced: bool,
    pub source: &'static str,
}

fn client() -> Option<Client> {
    Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Kubuno-Media/0.1 (+https://kubuno.com)")
        .build()
        .ok()
}

/// Tries every provider in turn and returns the first hit, or None.
pub async fn fetch(
    artist: &str,
    title: &str,
    album: Option<&str>,
    duration: Option<i32>,
) -> Option<Lyrics> {
    let artist = artist.trim();
    let title = title.trim();
    if artist.is_empty() || title.is_empty() {
        return None;
    }
    let c = client()?;

    // 1) LRCLIB exact match (best — gives synced lyrics).
    if let Some(l) = lrclib_get(&c, artist, title, album, duration).await {
        return Some(l);
    }
    // 2) LRCLIB fuzzy search.
    if let Some(l) = lrclib_search(&c, artist, title).await {
        return Some(l);
    }
    // 3) lyrics.ovh (plain text).
    if let Some(l) = lyrics_ovh(&c, artist, title).await {
        return Some(l);
    }
    // 4) ChartLyrics (plain text, last resort).
    if let Some(l) = chartlyrics(&c, artist, title).await {
        return Some(l);
    }
    None
}

#[derive(Deserialize)]
struct LrclibEntry {
    #[serde(rename = "syncedLyrics")]
    synced: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain:  Option<String>,
}

fn lrclib_pick(e: LrclibEntry) -> Option<Lyrics> {
    if let Some(s) = e.synced.filter(|s| s.trim().len() > 2) {
        return Some(Lyrics { text: s, synced: true, source: "LRCLIB" });
    }
    if let Some(p) = e.plain.filter(|s| s.trim().len() > 2) {
        return Some(Lyrics { text: p, synced: false, source: "LRCLIB" });
    }
    None
}

async fn lrclib_get(c: &Client, artist: &str, title: &str, album: Option<&str>, duration: Option<i32>) -> Option<Lyrics> {
    let mut q: Vec<(&str, String)> = vec![
        ("artist_name", artist.to_string()),
        ("track_name", title.to_string()),
    ];
    if let Some(a) = album.filter(|a| !a.is_empty()) {
        q.push(("album_name", a.to_string()));
    }
    if let Some(d) = duration.filter(|d| *d > 0) {
        q.push(("duration", d.to_string()));
    }
    let resp = c.get("https://lrclib.net/api/get").query(&q).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    lrclib_pick(resp.json::<LrclibEntry>().await.ok()?)
}

async fn lrclib_search(c: &Client, artist: &str, title: &str) -> Option<Lyrics> {
    let resp = c
        .get("https://lrclib.net/api/search")
        .query(&[("artist_name", artist), ("track_name", title)])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let list = resp.json::<Vec<LrclibEntry>>().await.ok()?;
    list.into_iter().find_map(lrclib_pick)
}

#[derive(Deserialize)]
struct LyricsOvh {
    lyrics: Option<String>,
}

async fn lyrics_ovh(c: &Client, artist: &str, title: &str) -> Option<Lyrics> {
    let url = format!(
        "https://api.lyrics.ovh/v1/{}/{}",
        urlencoding::encode(artist),
        urlencoding::encode(title),
    );
    let resp = c.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.json::<LyricsOvh>().await.ok()?;
    let text = body.lyrics.map(|s| s.replace("\r\n", "\n")).filter(|s| s.trim().len() > 2)?;
    Some(Lyrics { text, synced: false, source: "lyrics.ovh" })
}

async fn chartlyrics(c: &Client, artist: &str, title: &str) -> Option<Lyrics> {
    let url = format!(
        "http://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist={}&song={}",
        urlencoding::encode(artist),
        urlencoding::encode(title),
    );
    let xml = c.get(url).send().await.ok()?.text().await.ok()?;
    let start = xml.find("<Lyric>")? + "<Lyric>".len();
    let end = xml[start..].find("</Lyric>")? + start;
    let raw = &xml[start..end];
    if raw.trim().len() < 3 {
        return None;
    }
    let text = raw
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&apos;", "'")
        .replace("&quot;", "\"");
    Some(Lyrics { text, synced: false, source: "ChartLyrics" })
}
