//! TheAudioDB — artist images and localized biographies, looked up by
//! MusicBrainz ID.
//! Uses the public test API key, which allows MBID lookups.

use reqwest::Client;
use serde::Deserialize;

const BASE: &str = "https://www.theaudiodb.com/api/v1/json/2";

#[derive(Debug, Deserialize)]
struct AdbResponse {
    artists: Option<Vec<AdbArtist>>,
}

#[derive(Debug, Deserialize)]
pub struct AdbArtist {
    #[serde(rename = "strArtistThumb")]
    pub thumb: Option<String>,
    #[serde(rename = "strArtistFanart")]
    pub fanart: Option<String>,
    #[serde(rename = "strBiographyEN")]
    biography_en: Option<String>,
    #[serde(rename = "strBiographyFR")]
    biography_fr: Option<String>,
    #[serde(rename = "strBiographyDE")]
    biography_de: Option<String>,
    #[serde(rename = "strBiographyES")]
    biography_es: Option<String>,
    #[serde(rename = "strBiographyIT")]
    biography_it: Option<String>,
    #[serde(rename = "strBiographyPT")]
    biography_pt: Option<String>,
}

impl AdbArtist {
    /// Biography in the requested language ("fr", "de"…), if present.
    pub fn biography(&self, lang: &str) -> Option<String> {
        let lang = lang.split('-').next().unwrap_or("en");
        let bio = match lang {
            "fr" => &self.biography_fr,
            "de" => &self.biography_de,
            "es" => &self.biography_es,
            "it" => &self.biography_it,
            "pt" => &self.biography_pt,
            _    => &self.biography_en,
        };
        bio.clone().filter(|b| !b.trim().is_empty())
    }

    pub fn biography_english(&self) -> Option<String> {
        self.biography_en.clone().filter(|b| !b.trim().is_empty())
    }
}

/// Look up an artist by MusicBrainz ID. Returns None on any miss or error.
pub async fn artist_by_mbid(client: &Client, mbid: &str) -> Option<AdbArtist> {
    let url = format!("{BASE}/artist-mb.php?i={mbid}");
    let resp = client
        .get(&url)
        .header("User-Agent", "Kubuno/0.1 (self-hosted media server)")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: AdbResponse = resp.json().await.ok()?;
    data.artists?.into_iter().next()
}
