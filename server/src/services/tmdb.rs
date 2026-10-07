use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct TmdbService {
    pub client:  Client,
    pub api_key: String,
    pub base:    String,
    pub lang:    String,
    pub img_base: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbMovie {
    pub id:            i32,
    pub title:         String,
    pub original_title: Option<String>,
    pub overview:      Option<String>,
    pub tagline:       Option<String>,
    pub release_date:  Option<String>,
    pub runtime:       Option<i32>,
    pub vote_average:  Option<f64>,
    pub vote_count:    Option<i32>,
    pub popularity:    Option<f64>,
    pub poster_path:   Option<String>,
    pub backdrop_path: Option<String>,
    pub original_language: Option<String>,
    pub genres:        Option<Vec<TmdbGenre>>,
    pub production_countries: Option<Vec<TmdbCountry>>,
    pub imdb_id:       Option<String>,
    pub credits:       Option<TmdbCredits>,
    pub videos:        Option<TmdbVideos>,
    pub release_dates: Option<TmdbReleaseDates>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbVideos {
    pub results: Vec<TmdbVideo>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbVideo {
    pub key:  String,
    pub site: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub official: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbReleaseDates {
    pub results: Vec<TmdbReleaseCountry>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbReleaseCountry {
    pub iso_3166_1:    String,
    pub release_dates: Vec<TmdbReleaseEntry>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbReleaseEntry {
    pub certification: Option<String>,
}

impl TmdbMovie {
    /// Best YouTube trailer key (official trailers preferred).
    pub fn trailer_key(&self) -> Option<String> {
        let vids = &self.videos.as_ref()?.results;
        vids.iter()
            .filter(|v| v.site.as_deref() == Some("YouTube") && v.kind.as_deref() == Some("Trailer"))
            .max_by_key(|v| v.official.unwrap_or(false))
            .map(|v| v.key.clone())
    }

    /// Certification for the given country, falling back to US.
    pub fn certification(&self, country: &str) -> Option<String> {
        let results = &self.release_dates.as_ref()?.results;
        for c in [country, "US"] {
            if let Some(rc) = results.iter().find(|r| r.iso_3166_1.eq_ignore_ascii_case(c)) {
                if let Some(cert) = rc.release_dates.iter()
                    .filter_map(|e| e.certification.as_deref())
                    .find(|s| !s.is_empty())
                {
                    return Some(cert.to_string());
                }
            }
        }
        None
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbGenre {
    pub id:   i32,
    pub name: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbCountry {
    pub iso_3166_1: String,
    pub name:       String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbCredits {
    pub cast: Vec<TmdbCastMember>,
    pub crew: Vec<TmdbCrewMember>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbCastMember {
    pub name:         String,
    pub character:    Option<String>,
    pub profile_path: Option<String>,
    pub order:        Option<i32>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbCrewMember {
    pub name:         String,
    pub job:          Option<String>,
    pub department:   Option<String>,
    pub profile_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TmdbSearchResult<T> {
    results: Vec<T>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbShow {
    pub id:               i32,
    pub name:             String,
    pub original_name:    Option<String>,
    pub overview:         Option<String>,
    pub first_air_date:   Option<String>,
    pub vote_average:     Option<f64>,
    pub vote_count:       Option<i32>,
    pub poster_path:      Option<String>,
    pub backdrop_path:    Option<String>,
    pub genres:           Option<Vec<TmdbGenre>>,
    pub networks:         Option<Vec<TmdbNetwork>>,
    pub original_language: Option<String>,
    pub status:           Option<String>,
    pub number_of_seasons: Option<i32>,
    pub number_of_episodes: Option<i32>,
    pub credits:          Option<TmdbCredits>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TmdbNetwork {
    pub name: String,
}

impl TmdbService {
    pub fn new(client: Client, api_key: String, base: String, lang: String, img_base: String) -> Self {
        Self { client, api_key, base, lang, img_base }
    }

    pub fn is_configured(&self) -> bool {
        !self.api_key.is_empty()
    }

    /// TMDB accepts a short v3 key (`api_key` query param) or a long v4 read
    /// access token (Bearer). Support both, like users expect.
    fn with_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.api_key.len() > 60 {
            req.bearer_auth(&self.api_key)
        } else {
            req.query(&[("api_key", self.api_key.as_str())])
        }
    }

    pub async fn search_movie(&self, title: &str, year: Option<i32>) -> Result<Vec<TmdbMovie>> {
        if !self.is_configured() {
            return Ok(vec![]);
        }
        let mut params = vec![
            ("query",    title.to_string()),
            ("language", self.lang.clone()),
            ("include_adult", "false".to_string()),
        ];
        if let Some(y) = year {
            params.push(("primary_release_year", y.to_string()));
        }
        let req = self.client
            .get(format!("{}/search/movie", self.base))
            .query(&params);
        let resp: TmdbSearchResult<TmdbMovie> = self.with_auth(req)
            .send().await?
            .json().await?;
        Ok(resp.results)
    }

    pub async fn get_movie_details(&self, tmdb_id: i32) -> Result<TmdbMovie> {
        let req = self.client
            .get(format!("{}/movie/{}", self.base, tmdb_id))
            .query(&[
                ("language",           self.lang.as_str()),
                ("append_to_response", "credits,videos,release_dates"),
            ]);
        let resp = self.with_auth(req)
            .send().await?
            .error_for_status()?
            .json().await?;
        Ok(resp)
    }

    pub async fn get_show_details(&self, tmdb_id: i32) -> Result<TmdbShow> {
        let req = self.client
            .get(format!("{}/tv/{}", self.base, tmdb_id))
            .query(&[
                ("language",           self.lang.as_str()),
                ("append_to_response", "credits"),
            ]);
        let resp = self.with_auth(req)
            .send().await?
            .error_for_status()?
            .json().await?;
        Ok(resp)
    }

    pub async fn search_show(&self, title: &str, year: Option<i32>) -> Result<Vec<TmdbShow>> {
        if !self.is_configured() {
            return Ok(vec![]);
        }
        let mut params = vec![
            ("query",    title.to_string()),
            ("language", self.lang.clone()),
        ];
        if let Some(y) = year {
            params.push(("first_air_date_year", y.to_string()));
        }
        let req = self.client
            .get(format!("{}/search/tv", self.base))
            .query(&params);
        let resp: TmdbSearchResult<TmdbShow> = self.with_auth(req)
            .send().await?
            .json().await?;
        Ok(resp.results)
    }

    pub fn poster_url(&self, path: &str, size: &str) -> String {
        format!("{}/{}{}", self.img_base, size, path)
    }
}

// ── Keyless search (public TMDB website JSON, no API key) ────────────────────

/// A rich search candidate from the keyless TMDB website search.
/// Carries everything needed both for automatic matching and for the
/// manual "Identify" flow (the client applies the chosen candidate back).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmdbCandidate {
    /// None for candidates coming from non-TMDB sources (e.g. Wikipedia).
    #[serde(default)]
    pub tmdb_id:        Option<i64>,
    #[serde(default)]
    pub media_type:     String, // "movie" | "tv"
    pub title:          String,
    pub original_title: Option<String>,
    pub year:           Option<i32>,
    pub overview:       Option<String>,
    pub poster_url:     Option<String>,
    pub backdrop_url:   Option<String>,
    pub vote_average:   Option<f64>,
    pub vote_count:     Option<i64>,
}

/// Normalize a title for fuzzy-but-safe comparison: lowercase, strip accents
/// and any non-alphanumeric character. "Hunger (film, 2008)" and "hunger"
/// both normalize to "hunger".
pub fn normalize_title(s: &str) -> String {
    s.chars()
        .filter_map(|c| {
            let c = c.to_ascii_lowercase();
            match c {
                'à' | 'â' | 'ä' => Some('a'),
                'é' | 'è' | 'ê' | 'ë' => Some('e'),
                'î' | 'ï' => Some('i'),
                'ô' | 'ö' => Some('o'),
                'û' | 'ü' | 'ù' => Some('u'),
                'ç' => Some('c'),
                'a'..='z' | '0'..='9' => Some(c),
                _ => None,
            }
        })
        .collect()
}

/// Query the public TMDB website search JSON (`/search/trending`) — no API
/// key required — and return rich candidates of the requested `media_type`
/// ("movie" or "tv"). Returns an empty vec on any network/parse error.
pub async fn search_keyless(
    client:     &Client,
    query:      &str,
    media_type: &str,
) -> Vec<TmdbCandidate> {
    let query = query.trim();
    if query.is_empty() {
        return vec![];
    }
    let Ok(resp) = client
        .get("https://www.themoviedb.org/search/trending")
        .query(&[("query", query)])
        .header(
            "User-Agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        )
        .header("Accept", "application/json")
        .send()
        .await
    else {
        return vec![];
    };
    let Ok(json) = resp.json::<serde_json::Value>().await else {
        return vec![];
    };
    let Some(results) = json.get("results").and_then(|v| v.as_array()) else {
        return vec![];
    };

    results
        .iter()
        .filter(|r| r.get("media_type").and_then(|v| v.as_str()) == Some(media_type))
        .filter_map(|r| {
            let tmdb_id = r.get("id")?.as_i64()?;
            let title = r
                .get("title")
                .or_else(|| r.get("name"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())?
                .to_string();
            let original_title = r
                .get("original_title")
                .or_else(|| r.get("original_name"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from);
            let year = r
                .get("release_date")
                .or_else(|| r.get("first_air_date"))
                .and_then(|v| v.as_str())
                .and_then(|d| d.get(..4))
                .and_then(|y| y.parse::<i32>().ok());
            let img = |key: &str, size: &str| -> Option<String> {
                r.get(key)
                    .and_then(|v| v.as_str())
                    .filter(|p| !p.is_empty())
                    .map(|p| format!("https://image.tmdb.org/t/p/{size}{p}"))
            };
            Some(TmdbCandidate {
                tmdb_id: Some(tmdb_id),
                media_type: media_type.to_string(),
                title,
                original_title,
                year,
                overview: r
                    .get("overview")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(String::from),
                poster_url:   img("poster_path", "w500"),
                backdrop_url: img("backdrop_path", "w1280"),
                vote_average: r.get("vote_average").and_then(|v| v.as_f64()).filter(|v| *v > 0.0),
                vote_count:   r.get("vote_count").and_then(|v| v.as_i64()).filter(|v| *v > 0),
            })
        })
        .collect()
}

/// Pick the candidate that **confidently** matches the wanted title:
/// exact normalized title (main or original), with a year match preferred.
/// Returns None when nothing matches confidently — the caller keeps what it has.
pub fn best_match<'a>(
    candidates: &'a [TmdbCandidate],
    title:      &str,
    year:       Option<i32>,
) -> Option<&'a TmdbCandidate> {
    let want = normalize_title(title);
    if want.is_empty() {
        return None;
    }
    let title_matches = |c: &TmdbCandidate| {
        normalize_title(&c.title) == want
            || c.original_title.as_deref().map(normalize_title) == Some(want.clone())
    };
    if let Some(y) = year {
        if let Some(c) = candidates.iter().find(|c| title_matches(c) && c.year == Some(y)) {
            return Some(c);
        }
    }
    candidates.iter().find(|c| title_matches(c))
}

/// Look up a movie or TV entry by its TMDB id through the keyless search.
/// Used to re-match a stored `tmdb_id` on refresh without an API key.
pub async fn find_keyless_by_id(
    client:     &Client,
    query:      &str,
    media_type: &str,
    tmdb_id:    i64,
) -> Option<TmdbCandidate> {
    search_keyless(client, query, media_type)
        .await
        .into_iter()
        .find(|c| c.tmdb_id == Some(tmdb_id))
}
