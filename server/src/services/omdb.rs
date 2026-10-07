//! OMDb (omdbapi.com) — relays Rotten
//! Tomatoes, IMDb and Metacritic ratings. Rotten Tomatoes itself has no
//! public API; OMDb relays its Tomatometer legally with a free key.
//!
//! Lookup is by IMDb id when known (exact), else by title/year.

use reqwest::Client;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct OmdbResponse {
    #[serde(rename = "Response")]
    response: String,
    #[serde(rename = "imdbRating")]
    imdb_rating: Option<String>,
    #[serde(rename = "Metascore")]
    metascore: Option<String>,
    #[serde(rename = "Ratings")]
    ratings: Option<Vec<OmdbRating>>,
    /// IMDb poster (Amazon-hosted) — an extra artwork source.
    #[serde(rename = "Poster")]
    poster: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OmdbRating {
    #[serde(rename = "Source")]
    source: String,
    #[serde(rename = "Value")]
    value: String,
}

/// Normalized multi-source ratings, serialized into `ratings_json`.
#[derive(Debug, Default)]
pub struct Ratings {
    pub imdb:            Option<String>, // "8.8"
    pub rotten_tomatoes: Option<String>, // "87%"
    pub metacritic:      Option<String>, // "74/100"
    /// IMDb poster URL — added to the item's poster candidates.
    pub poster:          Option<String>,
}

impl Ratings {
    pub fn is_empty(&self) -> bool {
        self.imdb.is_none() && self.rotten_tomatoes.is_none()
            && self.metacritic.is_none() && self.poster.is_none()
    }

    pub fn to_json(&self) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        if let Some(v) = &self.imdb {
            map.insert("imdb".into(), serde_json::Value::String(v.clone()));
        }
        if let Some(v) = &self.rotten_tomatoes {
            map.insert("rotten_tomatoes".into(), serde_json::Value::String(v.clone()));
        }
        if let Some(v) = &self.metacritic {
            map.insert("metacritic".into(), serde_json::Value::String(v.clone()));
        }
        serde_json::Value::Object(map)
    }
}

fn clean(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "N/A")
}

/// Fetch ratings from OMDb. `kind` is "movie" or "series". Returns None on
/// any miss/error — ratings are always best-effort.
pub async fn fetch_ratings(
    client:  &Client,
    api_key: &str,
    imdb_id: Option<&str>,
    title:   &str,
    year:    Option<i32>,
    kind:    &str,
) -> Option<Ratings> {
    if api_key.is_empty() {
        return None;
    }
    let mut params: Vec<(String, String)> = vec![("apikey".into(), api_key.to_string())];
    match imdb_id.filter(|i| i.starts_with("tt")) {
        Some(i) => params.push(("i".into(), i.to_string())),
        None => {
            params.push(("t".into(), title.to_string()));
            params.push(("type".into(), kind.to_string()));
            if let Some(y) = year {
                params.push(("y".into(), y.to_string()));
            }
        }
    }

    let resp = client
        .get("https://www.omdbapi.com/")
        .query(&params)
        .send()
        .await
        .ok()?;
    let data: OmdbResponse = resp.json().await.ok()?;
    if data.response != "True" {
        return None;
    }

    let mut out = Ratings {
        imdb:       clean(data.imdb_rating),
        metacritic: clean(data.metascore).map(|m| if m.contains('/') { m } else { format!("{m}/100") }),
        poster:     clean(data.poster).filter(|p| p.starts_with("http")),
        ..Default::default()
    };
    for r in data.ratings.unwrap_or_default() {
        match r.source.as_str() {
            "Rotten Tomatoes" => out.rotten_tomatoes = clean(Some(r.value)),
            "Metacritic" if out.metacritic.is_none() => out.metacritic = clean(Some(r.value)),
            "Internet Movie Database" if out.imdb.is_none() => {
                out.imdb = clean(Some(r.value)).map(|v| v.split('/').next().unwrap_or(&v).to_string());
            }
            _ => {}
        }
    }

    (!out.is_empty()).then_some(out)
}
