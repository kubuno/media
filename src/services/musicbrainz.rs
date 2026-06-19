use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct MusicBrainzService {
    pub client: Client,
    pub base:   String,
    pub agent:  String,
    pub cover_art_url: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MbArtist {
    pub id:           String,
    pub name:         String,
    #[serde(rename = "sort-name")]
    pub sort_name:    Option<String>,
    #[serde(rename = "type")]
    pub artist_type:  Option<String>,
    pub country:      Option<String>,
    #[serde(rename = "life-span")]
    pub life_span:    Option<MbLifeSpan>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MbLifeSpan {
    pub begin: Option<String>,
    pub end:   Option<String>,
}

#[derive(Debug, Deserialize)]
struct MbSearchResult<T> {
    artists:  Option<Vec<T>>,
    #[allow(dead_code)]
    releases: Option<Vec<MbRelease>>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MbRelease {
    pub id:    String,
    pub title: String,
    pub date:  Option<String>,
}

#[derive(Debug, Deserialize)]
struct CoverArtResult {
    images: Vec<CoverArtImage>,
}

#[derive(Debug, Deserialize)]
struct CoverArtImage {
    front:      bool,
    image:      String,
    thumbnails: std::collections::HashMap<String, String>,
}

impl MusicBrainzService {
    pub fn new(client: Client, base: String, agent: String, cover_art_url: String) -> Self {
        Self { client, base, agent, cover_art_url }
    }

    async fn rate_limited_get(&self, url: &str) -> Result<reqwest::Response> {
        tokio::time::sleep(Duration::from_millis(1100)).await;
        let resp = self.client
            .get(url)
            .header("User-Agent", &self.agent)
            .header("Accept", "application/json")
            .send()
            .await?;
        Ok(resp)
    }

    pub async fn search_artist(&self, name: &str) -> Result<Vec<MbArtist>> {
        let url = format!(
            "{}/artist?query=artist:{}&fmt=json&limit=5",
            self.base,
            urlencoding::encode(name)
        );
        let resp = self.rate_limited_get(&url).await?;
        let data: MbSearchResult<MbArtist> = resp.json().await?;
        Ok(data.artists.unwrap_or_default())
    }

    pub async fn get_cover_art(&self, mbid: &str) -> Result<Option<String>> {
        let url = format!("{}/release/{}", self.cover_art_url, mbid);
        let resp = self.client
            .get(&url)
            .header("User-Agent", &self.agent)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Ok(None);
        }

        let data: CoverArtResult = resp.json().await?;
        let image = data.images.iter()
            .find(|i| i.front)
            .or_else(|| data.images.first());

        Ok(image.map(|img| {
            img.thumbnails.get("500")
                .or_else(|| img.thumbnails.get("large"))
                .cloned()
                .unwrap_or_else(|| img.image.clone())
        }))
    }
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
    }
}
