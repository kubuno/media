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
    pub id:             String,
    pub name:           String,
    #[serde(rename = "sort-name")]
    pub sort_name:      Option<String>,
    #[serde(rename = "type")]
    pub artist_type:    Option<String>,
    pub country:        Option<String>,
    pub disambiguation: Option<String>,
    pub score:          Option<i32>,
    #[serde(rename = "life-span")]
    pub life_span:      Option<MbLifeSpan>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MbLifeSpan {
    pub begin: Option<String>,
    pub end:   Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MbGenre {
    pub name:  String,
    pub count: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct MbUrlRelation {
    #[serde(rename = "type")]
    pub rel_type: Option<String>,
    pub url:      Option<MbUrl>,
}

#[derive(Debug, Deserialize)]
pub struct MbUrl {
    pub resource: String,
}

/// Full artist lookup (`/artist/{mbid}?inc=url-rels+genres`).
#[derive(Debug, Deserialize)]
pub struct MbArtistDetail {
    pub id:          String,
    pub name:        String,
    #[serde(rename = "sort-name")]
    pub sort_name:   Option<String>,
    #[serde(rename = "type")]
    pub artist_type: Option<String>,
    pub country:     Option<String>,
    #[serde(rename = "life-span")]
    pub life_span:   Option<MbLifeSpan>,
    pub genres:      Option<Vec<MbGenre>>,
    pub relations:   Option<Vec<MbUrlRelation>>,
}

impl MbArtistDetail {
    /// Wikidata Q-id from the artist's URL relations, when present.
    pub fn wikidata_qid(&self) -> Option<String> {
        self.relations
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter(|r| r.rel_type.as_deref() == Some("wikidata"))
            .filter_map(|r| r.url.as_ref())
            .filter_map(|u| u.resource.rsplit('/').next())
            .find(|q| q.starts_with('Q'))
            .map(String::from)
    }

    /// Genres sorted by vote count, top `n`, capitalized.
    pub fn top_genres(&self, n: usize) -> Vec<String> {
        let mut genres: Vec<_> = self.genres.as_deref().unwrap_or_default().iter().collect();
        genres.sort_by_key(|g| -(g.count.unwrap_or(0)));
        genres.into_iter().take(n).map(|g| capitalize(&g.name)).collect()
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MbArtistCredit {
    pub name: String,
}

/// Release-group search result (albums are matched to release-groups,
/// which represent "the album" across all its editions).
#[derive(Debug, Deserialize, Serialize)]
pub struct MbReleaseGroup {
    pub id:    String,
    pub title: String,
    #[serde(rename = "first-release-date")]
    pub first_release_date: Option<String>,
    #[serde(rename = "primary-type")]
    pub primary_type: Option<String>,
    pub score: Option<i32>,
    #[serde(rename = "artist-credit")]
    pub artist_credit: Option<Vec<MbArtistCredit>>,
    pub genres: Option<Vec<MbGenre>>,
}

impl MbReleaseGroup {
    pub fn artist_name(&self) -> Option<String> {
        self.artist_credit
            .as_deref()
            .unwrap_or_default()
            .first()
            .map(|a| a.name.clone())
    }

    pub fn first_release_year(&self) -> Option<i32> {
        self.first_release_date.as_deref()?.get(..4)?.parse().ok()
    }

    pub fn top_genres(&self, n: usize) -> Vec<String> {
        let mut genres: Vec<_> = self.genres.as_deref().unwrap_or_default().iter().collect();
        genres.sort_by_key(|g| -(g.count.unwrap_or(0)));
        genres.into_iter().take(n).map(|g| capitalize(&g.name)).collect()
    }
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[derive(Debug, Deserialize)]
struct MbArtistSearchResult {
    artists: Option<Vec<MbArtist>>,
}

#[derive(Debug, Deserialize)]
struct MbReleaseGroupSearchResult {
    #[serde(rename = "release-groups")]
    release_groups: Option<Vec<MbReleaseGroup>>,
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

    pub fn from_settings(client: Client, metadata: &crate::config::MetadataSettings) -> Self {
        Self::new(
            client,
            metadata.musicbrainz_url.clone(),
            metadata.musicbrainz_agent.clone(),
            metadata.cover_art_url.clone(),
        )
    }

    async fn rate_limited_get(&self, url: &str) -> Result<reqwest::Response> {
        // MusicBrainz allows ~1 req/s for anonymous clients.
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
        let query = format!("artist:\"{}\"", name.replace('"', ""));
        let url = format!(
            "{}/artist?query={}&fmt=json&limit=7",
            self.base,
            urlencoding::encode(&query)
        );
        let resp = self.rate_limited_get(&url).await?;
        let data: MbArtistSearchResult = resp.json().await?;
        Ok(data.artists.unwrap_or_default())
    }

    /// Full lookup with URL relations (wikidata link → biography) and genres.
    pub async fn get_artist(&self, mbid: &str) -> Result<MbArtistDetail> {
        let url = format!("{}/artist/{}?inc=url-rels+genres&fmt=json", self.base, mbid);
        let resp = self.rate_limited_get(&url).await?;
        Ok(resp.json().await?)
    }

    /// Search release-groups ("the album") by title, optionally scoped to an artist.
    pub async fn search_release_group(
        &self,
        title:  &str,
        artist: Option<&str>,
    ) -> Result<Vec<MbReleaseGroup>> {
        let mut query = format!("releasegroup:\"{}\"", title.replace('"', ""));
        if let Some(a) = artist.filter(|a| !a.trim().is_empty()) {
            query.push_str(&format!(" AND artist:\"{}\"", a.replace('"', "")));
        }
        let url = format!(
            "{}/release-group?query={}&fmt=json&limit=7",
            self.base,
            urlencoding::encode(&query)
        );
        let resp = self.rate_limited_get(&url).await?;
        let data: MbReleaseGroupSearchResult = resp.json().await?;
        Ok(data.release_groups.unwrap_or_default())
    }

    /// Release-group lookup with genres + artist credit (for the Identify flow).
    pub async fn get_release_group(&self, mbid: &str) -> Result<MbReleaseGroup> {
        let url = format!(
            "{}/release-group/{}?inc=genres+artist-credits&fmt=json",
            self.base, mbid
        );
        let resp = self.rate_limited_get(&url).await?;
        Ok(resp.json().await?)
    }

    /// Front cover of a release-group from the Cover Art Archive.
    pub async fn release_group_cover(&self, rg_mbid: &str) -> Result<Option<String>> {
        let url = format!("{}/release-group/{}", self.cover_art_url, rg_mbid);
        self.fetch_cover(&url).await
    }

    /// Front cover of a specific release from the Cover Art Archive.
    pub async fn get_cover_art(&self, mbid: &str) -> Result<Option<String>> {
        let url = format!("{}/release/{}", self.cover_art_url, mbid);
        self.fetch_cover(&url).await
    }

    async fn fetch_cover(&self, url: &str) -> Result<Option<String>> {
        let resp = self.client
            .get(url)
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
            let url = img.thumbnails.get("500")
                .or_else(|| img.thumbnails.get("large"))
                .cloned()
                .unwrap_or_else(|| img.image.clone());
            // CAA returns http:// URLs — force https to avoid mixed content.
            url.replacen("http://", "https://", 1)
        }))
    }
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
    }
}
