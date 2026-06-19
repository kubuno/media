use anyhow::Result;
use reqwest::Client;
use serde::Deserialize;

const SPARQL: &str = "https://query.wikidata.org/sparql";

pub struct WikidataService {
    client:   Client,
    language: String,
}

pub struct WikidataMovieResult {
    pub title:          Option<String>,
    pub overview:       Option<String>,
    pub poster_url:     Option<String>,
    pub release_year:   Option<i32>,
    pub genres:         Vec<String>,
}

pub struct WikidataMovieExtras {
    pub directors:      Vec<String>,
    pub writers:        Vec<String>,
    pub producers:      Vec<String>,
    pub content_rating: Option<String>,
    pub poster_urls:    Vec<String>,
}

pub struct WikidataShowResult {
    pub title:          Option<String>,
    pub overview:       Option<String>,
    pub poster_url:     Option<String>,
    pub first_air_year: Option<i32>,
    pub genres:         Vec<String>,
    pub networks:       Vec<String>,
}

#[derive(Deserialize)]
struct WikipediaSummary {
    extract:   Option<String>,
    thumbnail: Option<WikipediaThumbnail>,
    title:     Option<String>,
}

#[derive(Deserialize)]
struct WikipediaThumbnail {
    source: String,
}

#[derive(Deserialize)]
struct WikipediaSearchResponse {
    query: WikipediaSearchQuery,
}

#[derive(Deserialize)]
struct WikipediaSearchQuery {
    search: Vec<WikipediaSearchPage>,
}

#[derive(Deserialize)]
struct WikipediaSearchPage {
    title: String,
}

#[derive(Deserialize)]
struct SparqlResponse {
    results: SparqlResults,
}

#[derive(Deserialize)]
struct SparqlResults {
    bindings: Vec<serde_json::Value>,
}

impl WikidataService {
    pub fn new(client: Client, language: String) -> Self {
        Self { client, language }
    }

    pub async fn search_movie(
        &self,
        title: &str,
        year: Option<i32>,
    ) -> Result<Option<WikidataMovieResult>> {
        // Step 1: search Wikipedia for a movie article
        let wiki_page = self.wikipedia_search_movie(title, year).await?;

        if let Some(page_title) = wiki_page {
            // Step 2: get summary (overview + thumbnail)
            if let Ok(summary) = self.get_wikipedia_summary(&page_title).await {
                let genres = self.wikidata_genres(title, year).await.unwrap_or_default();
                return Ok(Some(WikidataMovieResult {
                    title:        summary.title,
                    overview:     summary.extract,
                    poster_url:   summary.thumbnail.map(|t| t.source),
                    release_year: year,
                    genres,
                }));
            }
        }

        // Step 3: Wikidata SPARQL fallback — poster from P18 property
        self.wikidata_sparql_movie(title, year).await
    }

    /// Searches in multiple languages and merges the best data from each.
    /// - Overview: longest non-empty result wins
    /// - Poster: first available
    /// - Genres: union (deduplicated)
    /// - Title: first non-None result (preferred language first)
    pub async fn search_movie_combined(
        &self,
        title: &str,
        year: Option<i32>,
        extra_langs: &[&str],
    ) -> Result<Option<WikidataMovieResult>> {
        let primary = self.search_movie(title, year).await?;

        let mut combined = match primary {
            Some(r) => r,
            None => WikidataMovieResult {
                title:        None,
                overview:     None,
                poster_url:   None,
                release_year: year,
                genres:       vec![],
            },
        };

        for &lang in extra_langs {
            // Skip if we already have both a rich overview and a poster
            let overview_rich = combined.overview.as_deref().map(|s| s.len()).unwrap_or(0) >= 200;
            if overview_rich && combined.poster_url.is_some() {
                break;
            }

            let alt = WikidataService::new(self.client.clone(), lang.to_string());
            if let Ok(Some(r)) = alt.search_movie(title, year).await {
                // Merge title
                if combined.title.is_none() {
                    combined.title = r.title;
                }
                // Merge overview: keep the longer one
                let alt_len = r.overview.as_deref().map(|s| s.len()).unwrap_or(0);
                let cur_len = combined.overview.as_deref().map(|s| s.len()).unwrap_or(0);
                if alt_len > cur_len {
                    combined.overview = r.overview;
                }
                // Merge poster
                if combined.poster_url.is_none() {
                    combined.poster_url = r.poster_url;
                }
                // Merge genres (deduplicated, lowercase comparison)
                for g in r.genres {
                    let already = combined.genres.iter().any(|x| x.to_lowercase() == g.to_lowercase());
                    if !already {
                        combined.genres.push(g);
                    }
                }
            }
        }

        if combined.title.is_none() && combined.overview.is_none() && combined.genres.is_empty() {
            return Ok(None);
        }
        Ok(Some(combined))
    }

    /// Same as search_show but merges results across multiple languages.
    pub async fn search_show_combined(
        &self,
        title: &str,
        year: Option<i32>,
        extra_langs: &[&str],
    ) -> Result<Option<WikidataShowResult>> {
        let primary = self.search_show(title, year).await?;

        let mut combined = match primary {
            Some(r) => r,
            None => WikidataShowResult {
                title:          None,
                overview:       None,
                poster_url:     None,
                first_air_year: year,
                genres:         vec![],
                networks:       vec![],
            },
        };

        for &lang in extra_langs {
            let overview_rich = combined.overview.as_deref().map(|s| s.len()).unwrap_or(0) >= 200;
            if overview_rich && combined.poster_url.is_some() {
                break;
            }

            let alt = WikidataService::new(self.client.clone(), lang.to_string());
            if let Ok(Some(r)) = alt.search_show(title, year).await {
                if combined.title.is_none() { combined.title = r.title; }
                let alt_len = r.overview.as_deref().map(|s| s.len()).unwrap_or(0);
                let cur_len = combined.overview.as_deref().map(|s| s.len()).unwrap_or(0);
                if alt_len > cur_len { combined.overview = r.overview; }
                if combined.poster_url.is_none() { combined.poster_url = r.poster_url; }
                for g in r.genres {
                    if !combined.genres.iter().any(|x| x.to_lowercase() == g.to_lowercase()) {
                        combined.genres.push(g);
                    }
                }
                for n in r.networks {
                    if !combined.networks.contains(&n) { combined.networks.push(n); }
                }
            }
        }

        if combined.title.is_none() && combined.overview.is_none() && combined.genres.is_empty() {
            return Ok(None);
        }
        Ok(Some(combined))
    }

    async fn wikipedia_search_movie(
        &self,
        title: &str,
        year: Option<i32>,
    ) -> Result<Option<String>> {
        let lang = self.language.split('-').next().unwrap_or("en");
        let query = if let Some(y) = year {
            format!("{title} {y} film")
        } else {
            format!("{title} film")
        };
        let encoded = url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>();
        let search_url = format!(
            "https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={encoded}&format=json&srlimit=3"
        );
        let resp = self.client
            .get(&search_url)
            .header("User-Agent", "Kubuno/0.1 (self-hosted media server; https://github.com/kubuno/kubuno)")
            .send()
            .await?
            .json::<WikipediaSearchResponse>()
            .await?;

        Ok(resp.query.search.into_iter().next().map(|p| p.title))
    }

    async fn get_wikipedia_summary(&self, page_title: &str) -> Result<WikipediaSummary> {
        let lang = self.language.split('-').next().unwrap_or("en");
        // Wikipedia REST API uses underscores (not + from form-urlencoding) for spaces
        let encoded = page_title.replace(' ', "_");
        let url = format!("https://{lang}.wikipedia.org/api/rest_v1/page/summary/{encoded}");
        let summary = self.client
            .get(&url)
            .header("User-Agent", "Kubuno/0.1 (self-hosted media server)")
            .send()
            .await?
            .json::<WikipediaSummary>()
            .await?;
        Ok(summary)
    }

    async fn wikidata_genres(&self, title: &str, year: Option<i32>) -> Result<Vec<String>> {
        let lang = self.language.split('-').next().unwrap_or("en");
        let title_escaped = title.replace('"', "\\\"");
        let year_filter = year.map_or(String::new(), |y| {
            format!("FILTER(YEAR(?date) = {})", y)
        });

        let sparql = format!(
            r#"SELECT ?genreLabel WHERE {{
              ?item wdt:P31 wd:Q11424 .
              ?item rdfs:label "{title_escaped}"@{lang} .
              OPTIONAL {{ ?item wdt:P577 ?date . {year_filter} }}
              OPTIONAL {{ ?item wdt:P136 ?genre . }}
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "{lang},en" . }}
            }} LIMIT 5"#
        );

        let resp = self.client
            .get(SPARQL)
            .query(&[("query", &sparql), ("format", &"json".to_string())])
            .header("User-Agent", "Kubuno/0.1 (self-hosted media server)")
            .header("Accept", "application/sparql-results+json")
            .send()
            .await?
            .json::<SparqlResponse>()
            .await?;

        let genres = resp.results.bindings
            .iter()
            .filter_map(|b| {
                b.get("genreLabel")
                    .and_then(|v| v.get("value"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .collect();

        Ok(genres)
    }

    pub async fn search_show(
        &self,
        title: &str,
        year: Option<i32>,
    ) -> Result<Option<WikidataShowResult>> {
        // Step 1: search Wikipedia for a TV series article
        let wiki_page = self.wikipedia_search_show(title, year).await?;

        if let Some(page_title) = wiki_page {
            if let Ok(summary) = self.get_wikipedia_summary(&page_title).await {
                let (genres, networks) = self
                    .wikidata_show_genres_networks(title, year)
                    .await
                    .unwrap_or_default();
                return Ok(Some(WikidataShowResult {
                    title:          summary.title,
                    overview:       summary.extract,
                    poster_url:     summary.thumbnail.map(|t| t.source),
                    first_air_year: year,
                    genres,
                    networks,
                }));
            }
        }

        // Step 2: SPARQL fallback
        self.wikidata_sparql_show(title, year).await
    }

    async fn wikipedia_search_show(
        &self,
        title: &str,
        year: Option<i32>,
    ) -> Result<Option<String>> {
        let lang = self.language.split('-').next().unwrap_or("en");
        let query = if let Some(y) = year {
            format!("{title} {y} TV series")
        } else {
            format!("{title} TV series")
        };
        let encoded = url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>();
        let search_url = format!(
            "https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={encoded}&format=json&srlimit=3"
        );
        let resp = self.client
            .get(&search_url)
            .header("User-Agent", "Kubuno/0.1 (self-hosted media server; https://github.com/kubuno/kubuno)")
            .send()
            .await?
            .json::<WikipediaSearchResponse>()
            .await?;
        Ok(resp.query.search.into_iter().next().map(|p| p.title))
    }

    async fn wikidata_show_genres_networks(
        &self,
        title: &str,
        year: Option<i32>,
    ) -> Result<(Vec<String>, Vec<String>)> {
        let lang = self.language.split('-').next().unwrap_or("en");
        let title_escaped = title.replace('"', "\\\"");
        let year_filter = year.map_or(String::new(), |y| {
            format!("FILTER(YEAR(?date) = {})", y)
        });

        // P31=Q5398426 (television series), P136=genre, P449=original network, P580=start time
        let sparql = format!(
            r#"SELECT ?genreLabel ?networkLabel WHERE {{
              ?item wdt:P31/wdt:P279* wd:Q5398426 .
              ?item rdfs:label "{title_escaped}"@{lang} .
              OPTIONAL {{ ?item wdt:P580 ?date . {year_filter} }}
              OPTIONAL {{ ?item wdt:P136 ?genre . }}
              OPTIONAL {{ ?item wdt:P449 ?network . }}
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "{lang},en" . }}
            }} LIMIT 10"#
        );

        let resp = self.client
            .get(SPARQL)
            .query(&[("query", &sparql), ("format", &"json".to_string())])
            .header("User-Agent", "Kubuno/0.1 (self-hosted media server)")
            .header("Accept", "application/sparql-results+json")
            .send()
            .await?
            .json::<SparqlResponse>()
            .await?;

        let mut genres = Vec::new();
        let mut networks = Vec::new();
        for b in &resp.results.bindings {
            if let Some(g) = b.get("genreLabel").and_then(|v| v.get("value")).and_then(|v| v.as_str()) {
                if !genres.contains(&g.to_string()) { genres.push(g.to_string()); }
            }
            if let Some(n) = b.get("networkLabel").and_then(|v| v.get("value")).and_then(|v| v.as_str()) {
                if !networks.contains(&n.to_string()) { networks.push(n.to_string()); }
            }
        }
        Ok((genres, networks))
    }

    async fn wikidata_sparql_show(
        &self,
        title: &str,
        year: Option<i32>,
    ) -> Result<Option<WikidataShowResult>> {
        let lang = self.language.split('-').next().unwrap_or("en");
        let title_escaped = title.replace('"', "\\\"");
        let year_filter = year.map_or(String::new(), |y| {
            format!("FILTER(YEAR(?date) = {})", y)
        });

        let sparql = format!(
            r#"SELECT DISTINCT ?item ?itemLabel ?poster ?date ?genreLabel ?networkLabel WHERE {{
              ?item wdt:P31/wdt:P279* wd:Q5398426 .
              ?item rdfs:label "{title_escaped}"@{lang} .
              OPTIONAL {{ ?item wdt:P18 ?poster . }}
              OPTIONAL {{ ?item wdt:P580 ?date . {year_filter} }}
              OPTIONAL {{ ?item wdt:P136 ?genre . }}
              OPTIONAL {{ ?item wdt:P449 ?network . }}
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "{lang},en" . }}
            }} LIMIT 10"#
        );

        let resp = self.client
            .get(SPARQL)
            .query(&[("query", &sparql), ("format", &"json".to_string())])
            .header("User-Agent", "Kubuno/0.1 (self-hosted media server)")
            .header("Accept", "application/sparql-results+json")
            .send()
            .await?
            .json::<SparqlResponse>()
            .await?;

        if resp.results.bindings.is_empty() {
            return Ok(None);
        }

        let first = &resp.results.bindings[0];

        let item_title = first.get("itemLabel")
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let poster_url = first.get("poster")
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let first_air_year = first.get("date")
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.split('-').next())
            .and_then(|s| s.parse::<i32>().ok());

        let mut genres = Vec::new();
        let mut networks = Vec::new();
        for b in &resp.results.bindings {
            if let Some(g) = b.get("genreLabel").and_then(|v| v.get("value")).and_then(|v| v.as_str()) {
                if !genres.contains(&g.to_string()) { genres.push(g.to_string()); }
            }
            if let Some(n) = b.get("networkLabel").and_then(|v| v.get("value")).and_then(|v| v.as_str()) {
                if !networks.contains(&n.to_string()) { networks.push(n.to_string()); }
            }
        }

        Ok(Some(WikidataShowResult {
            title: item_title,
            overview: None,
            poster_url,
            first_air_year,
            genres,
            networks,
        }))
    }

    /// Fetches crew (directors, writers, producers), content rating, and all poster URLs
    /// from Wikidata for a movie. Always uses English labels as the primary source.
    pub async fn wikidata_movie_extras(
        &self,
        title: &str,
        year: Option<i32>,
    ) -> Result<WikidataMovieExtras> {
        let title_escaped = title.replace('"', "\\\"");

        // When year is known, use it as a mandatory filter to avoid matching
        // unrelated films with the same title from other years.
        let year_clause = year.map_or(String::new(), |y| {
            format!("?item wdt:P577 ?date . FILTER(YEAR(?date) = {y}) .")
        });

        // P57=director, P58=screenwriter, P162=producer, P852=MPAA rating, P18=image
        let sparql = format!(
            r#"SELECT DISTINCT ?directorLabel ?writerLabel ?producerLabel ?ratingLabel ?poster WHERE {{
              ?item wdt:P31 wd:Q11424 .
              {{ ?item rdfs:label "{title_escaped}"@en }} UNION {{ ?item rdfs:label "{title_escaped}"@fr }}
              {year_clause}
              OPTIONAL {{ ?item wdt:P57  ?director . }}
              OPTIONAL {{ ?item wdt:P58  ?writer . }}
              OPTIONAL {{ ?item wdt:P162 ?producer . }}
              OPTIONAL {{ ?item wdt:P852 ?rating . }}
              OPTIONAL {{ ?item wdt:P18  ?poster . }}
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,fr" . }}
            }} LIMIT 30"#
        );

        let resp = self.client
            .get(SPARQL)
            .query(&[("query", &sparql), ("format", &"json".to_string())])
            .header("User-Agent", "Kubuno/0.1 (self-hosted media server)")
            .header("Accept", "application/sparql-results+json")
            .send()
            .await?
            .json::<SparqlResponse>()
            .await?;

        let mut directors:   Vec<String> = Vec::new();
        let mut writers:     Vec<String> = Vec::new();
        let mut producers:   Vec<String> = Vec::new();
        let mut ratings:     Vec<String> = Vec::new();
        let mut poster_urls: Vec<String> = Vec::new();

        for b in &resp.results.bindings {
            let get = |key: &str| -> Option<String> {
                b.get(key)
                    .and_then(|v| v.get("value"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            };
            if let Some(d) = get("directorLabel")  { if !directors.contains(&d)  { directors.push(d);  } }
            if let Some(w) = get("writerLabel")     { if !writers.contains(&w)    { writers.push(w);    } }
            if let Some(p) = get("producerLabel")   { if !producers.contains(&p)  { producers.push(p);  } }
            if let Some(r) = get("ratingLabel")     { if !ratings.contains(&r)    { ratings.push(r);    } }
            if let Some(u) = get("poster") {
                // Wikidata returns Wikimedia Commons URLs; convert to usable image URL
                let url = if u.contains("Special:FilePath") {
                    u.clone()
                } else {
                    format!("https://commons.wikimedia.org/wiki/Special:FilePath/{}", u.split('/').next_back().unwrap_or(""))
                };
                if !poster_urls.contains(&url) { poster_urls.push(url); }
            }
        }

        // Use the first (usually most relevant) rating
        let content_rating = ratings.into_iter().next()
            .filter(|r| !r.starts_with("Q"));  // skip Wikidata QIDs that weren't labeled

        Ok(WikidataMovieExtras {
            directors,
            writers,
            producers,
            content_rating,
            poster_urls,
        })
    }

    async fn wikidata_sparql_movie(
        &self,
        title: &str,
        year: Option<i32>,
    ) -> Result<Option<WikidataMovieResult>> {
        let lang = self.language.split('-').next().unwrap_or("en");
        let title_escaped = title.replace('"', "\\\"");
        let year_filter = year.map_or(String::new(), |y| {
            format!("FILTER(YEAR(?date) = {})", y)
        });

        let sparql = format!(
            r#"SELECT DISTINCT ?item ?itemLabel ?poster ?date ?genreLabel WHERE {{
              ?item wdt:P31 wd:Q11424 .
              ?item rdfs:label "{title_escaped}"@{lang} .
              OPTIONAL {{ ?item wdt:P18 ?poster . }}
              OPTIONAL {{ ?item wdt:P577 ?date . {year_filter} }}
              OPTIONAL {{ ?item wdt:P136 ?genre . }}
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "{lang},en" . }}
            }} LIMIT 5"#
        );

        let resp = self.client
            .get(SPARQL)
            .query(&[("query", &sparql), ("format", &"json".to_string())])
            .header("User-Agent", "Kubuno/0.1 (self-hosted media server)")
            .header("Accept", "application/sparql-results+json")
            .send()
            .await?
            .json::<SparqlResponse>()
            .await?;

        if resp.results.bindings.is_empty() {
            return Ok(None);
        }

        let first = &resp.results.bindings[0];

        let item_title = first.get("itemLabel")
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let poster_url = first.get("poster")
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let release_year = first.get("date")
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.split('-').next())
            .and_then(|s| s.parse::<i32>().ok());

        let genres: Vec<String> = resp.results.bindings
            .iter()
            .filter_map(|b| {
                b.get("genreLabel")
                    .and_then(|v| v.get("value"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .collect();

        Ok(Some(WikidataMovieResult {
            title: item_title,
            overview: None,
            poster_url,
            release_year,
            genres,
        }))
    }
}
