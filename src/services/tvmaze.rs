use anyhow::Result;
use reqwest::Client;
use serde::Deserialize;

const BASE: &str = "https://api.tvmaze.com";

pub struct TvMazeService {
    client: Client,
}

#[derive(Debug, Deserialize)]
pub struct TvMazeSearchResult {
    pub score: f64,
    pub show:  TvMazeShow,
}

#[derive(Debug, Deserialize)]
pub struct TvMazeShow {
    pub id:        i32,
    pub name:      String,
    pub language:  Option<String>,
    pub genres:    Vec<String>,
    pub status:    Option<String>,
    pub premiered: Option<String>,
    pub ended:     Option<String>,
    pub summary:   Option<String>,
    pub image:     Option<TvMazeImage>,
    pub network:   Option<TvMazeNetwork>,
    #[serde(rename = "_embedded")]
    pub embedded:  Option<TvMazeEmbedded>,
}

#[derive(Debug, Deserialize)]
pub struct TvMazeImage {
    pub medium:   Option<String>,
    pub original: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvMazeNetwork {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct TvMazeEmbedded {
    pub episodes: Option<Vec<TvMazeEpisode>>,
}

#[derive(Debug, Deserialize)]
pub struct TvMazeEpisode {
    pub id:      i32,
    pub name:    Option<String>,
    pub season:  i32,
    pub number:  Option<i32>,
    pub airdate: Option<String>,
    pub runtime: Option<i32>,
    pub summary: Option<String>,
    pub image:   Option<TvMazeImage>,
}

impl TvMazeService {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    pub async fn search_show(&self, query: &str) -> Result<Vec<TvMazeSearchResult>> {
        let encoded = url::form_urlencoded::byte_serialize(query.as_bytes())
            .collect::<String>();
        let resp = self.client
            .get(format!("{BASE}/search/shows?q={encoded}"))
            .send()
            .await?
            .json::<Vec<TvMazeSearchResult>>()
            .await?;
        Ok(resp)
    }

    pub async fn get_show_with_episodes(&self, id: i32) -> Result<TvMazeShow> {
        let show = self.client
            .get(format!("{BASE}/shows/{id}?embed=episodes"))
            .send()
            .await?
            .json::<TvMazeShow>()
            .await?;
        Ok(show)
    }

    pub async fn get_show_seasons(&self, id: i32) -> Result<Vec<TvMazeSeason>> {
        let seasons = self.client
            .get(format!("{BASE}/shows/{id}/seasons"))
            .send()
            .await?
            .json::<Vec<TvMazeSeason>>()
            .await?;
        Ok(seasons)
    }
}

#[derive(Debug, Deserialize)]
pub struct TvMazeSeason {
    pub id:            i32,
    pub number:        i32,
    pub name:          Option<String>,
    #[serde(rename = "episodeOrder")]
    pub episode_order: Option<i32>,
    #[serde(rename = "premiereDate")]
    pub premiere_date: Option<String>,
    pub image:         Option<TvMazeImage>,
    pub summary:       Option<String>,
}

/// Strip basic HTML tags (TVMaze wraps summaries in <p> tags).
pub fn strip_html(s: &str) -> String {
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    let stripped = re.replace_all(s, "").to_string();
    stripped
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .trim()
        .to_string()
}
