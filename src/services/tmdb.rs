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
        let resp: TmdbSearchResult<TmdbMovie> = self.client
            .get(format!("{}/search/movie", self.base))
            .query(&params)
            .bearer_auth(&self.api_key)
            .send().await?
            .json().await?;
        Ok(resp.results)
    }

    pub async fn get_movie_details(&self, tmdb_id: i32) -> Result<TmdbMovie> {
        let resp = self.client
            .get(format!("{}/movie/{}", self.base, tmdb_id))
            .query(&[
                ("language",           self.lang.as_str()),
                ("append_to_response", "credits"),
            ])
            .bearer_auth(&self.api_key)
            .send().await?
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
        let resp: TmdbSearchResult<TmdbShow> = self.client
            .get(format!("{}/search/tv", self.base))
            .query(&params)
            .bearer_auth(&self.api_key)
            .send().await?
            .json().await?;
        Ok(resp.results)
    }

    pub fn poster_url(&self, path: &str, size: &str) -> String {
        format!("{}/{}{}", self.img_base, size, path)
    }
}
