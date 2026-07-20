//! Curated catalogue of live TV channels, seeded as builtin channels at
//! startup (idempotent upsert keyed by `slug`).
//!
//! Inclusion criterion (same as the radio catalogue): ONLY channels that
//! openly publish their live stream themselves, on their own CDN, for free
//! unrestricted viewing (public broadcasters, international news services
//! funded for worldwide free distribution). No third-party platform streams,
//! no pay-TV, nothing that requires authentication upstream.
//!
//! Stream URLs can drift over time; users can add custom channels or use the
//! discovery search (iptv-org community catalogue) to find current streams.

use serde::Deserialize;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

pub struct TvSeed {
    pub slug:       &'static str,
    pub name:       &'static str,
    pub stream_url: &'static str,
    pub homepage:   &'static str,
    pub logo:       &'static str,
    pub categories: &'static [&'static str],
    pub country:    &'static str,
    pub language:   &'static str,
}

#[allow(clippy::too_many_arguments)]
const fn c(
    slug: &'static str, name: &'static str, stream_url: &'static str, homepage: &'static str,
    logo: &'static str, categories: &'static [&'static str], country: &'static str,
    language: &'static str,
) -> TvSeed {
    TvSeed { slug, name, stream_url, homepage, logo, categories, country, language }
}

pub fn catalog() -> Vec<TvSeed> {
    // Every URL below was verified reachable (HTTP 200, no auth, no geo-token)
    // on the broadcaster's own CDN at the time of writing.
    vec![
        // ── Culture / francophone ──
        c("arte-fr", "Arte (français)", "https://artesimulcast.akamaized.net/hls/live/2031003/artelive_fr/index.m3u8", "https://www.arte.tv/fr/", "https://upload.wikimedia.org/wikipedia/commons/e/e8/Arte_Logo_2017.svg", &["culture", "documentaire"], "France", "fr"),

        // ── International — info ──
        c("dw-en", "DW English", "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8", "https://www.dw.com", "https://upload.wikimedia.org/wikipedia/commons/e/e9/Deutsche_Welle_symbol_2012.svg", &["info"], "Allemagne", "en"),
        c("dw-de", "DW Deutsch", "https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8", "https://www.dw.com/de/", "https://upload.wikimedia.org/wikipedia/commons/e/e9/Deutsche_Welle_symbol_2012.svg", &["info"], "Allemagne", "de"),
        c("aljazeera-en", "Al Jazeera English", "https://live-hls-apps-aje-fa.getaj.net/AJE/index.m3u8", "https://www.aljazeera.com", "https://upload.wikimedia.org/wikipedia/commons/f/f7/Aljazeera_eng.svg", &["info"], "Qatar", "en"),
        c("aljazeera-ar", "Al Jazeera Arabic", "https://live-hls-apps-aja-fa.getaj.net/AJA/index.m3u8", "https://www.aljazeera.net", "https://upload.wikimedia.org/wikipedia/commons/f/f7/Aljazeera_eng.svg", &["info"], "Qatar", "ar"),
        c("cna", "CNA (Channel NewsAsia)", "https://d2e1asnsl7br7b.cloudfront.net/7782e205e72f43aeb4a48ec97f66ebbe/index.m3u8", "https://www.channelnewsasia.com", "https://upload.wikimedia.org/wikipedia/commons/6/6b/CNA_new_logo.svg", &["info"], "Singapour", "en"),
        c("tagesschau24", "tagesschau24", "https://tagesschau.akamaized.net/hls/live/2020115/tagesschau/tagesschau_1/master.m3u8", "https://www.tagesschau.de", "https://upload.wikimedia.org/wikipedia/commons/8/8d/Tagesschau24-2012.svg", &["info"], "Allemagne", "de"),

        // ── Documentaire / science / sport ──
        c("nasa-tv", "NASA TV", "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8", "https://www.nasa.gov/nasatv", "https://upload.wikimedia.org/wikipedia/commons/e/e5/NASA_logo.svg", &["science", "espace"], "États-Unis", "en"),
        c("redbull-tv", "Red Bull TV", "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8", "https://www.redbull.com/tv", "https://upload.wikimedia.org/wikipedia/commons/f/f5/RedBullEnergyDrink.svg", &["sport", "aventure"], "Autriche", "en"),
    ]
}

pub async fn seed(db: &PgPool) {
    let items = catalog();
    let count = items.len();
    // Remove builtin channels dropped from the catalogue (dead/withdrawn streams).
    let keep: Vec<String> = items.iter().map(|s| s.slug.to_string()).collect();
    let _ = sqlx::query("DELETE FROM media.tv_channels WHERE is_builtin AND slug <> ALL($1)")
        .bind(&keep)
        .execute(db)
        .await;
    for s in items {
        let categories: Vec<String> = s.categories.iter().map(|t| t.to_string()).collect();
        let res = sqlx::query(
            r#"INSERT INTO media.tv_channels
                 (name, stream_url, homepage, logo, categories, country, language, is_builtin, slug)
               VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8)
               ON CONFLICT (slug) DO UPDATE SET
                 name = EXCLUDED.name, stream_url = EXCLUDED.stream_url, homepage = EXCLUDED.homepage,
                 logo = EXCLUDED.logo, categories = EXCLUDED.categories, country = EXCLUDED.country,
                 language = EXCLUDED.language, updated_at = NOW()"#,
        )
        .bind(s.name)
        .bind(s.stream_url)
        .bind(s.homepage)
        .bind(s.logo)
        .bind(&categories)
        .bind(s.country)
        .bind(s.language)
        .bind(s.slug)
        .execute(db)
        .await;
        if let Err(e) = res {
            tracing::warn!(error = %e, slug = %s.slug, "seed tv channel");
        }
    }
    tracing::info!(count, "Catalogue TV builtin synchronisé");
}

// ── Discovery: iptv-org community catalogue ──────────────────────────────────
// https://iptv-org.github.io/api/ — static JSON dumps of publicly available
// streams. The files are large (~10 MB), so we cache the joined result in
// memory and refresh at most every 12 h.

#[derive(Debug, Deserialize)]
struct IptvChannel {
    id:         String,
    name:       String,
    #[serde(default)]
    country:    Option<String>,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    logo:       Option<String>,
    #[serde(default)]
    website:    Option<String>,
    #[serde(default)]
    is_nsfw:    bool,
}

#[derive(Debug, Deserialize)]
struct IptvStream {
    channel: Option<String>,
    url:     String,
}

/// One discoverable channel (joined channel metadata + a playable stream URL).
#[derive(Debug, Clone)]
pub struct DiscoveredChannel {
    pub name:       String,
    pub stream_url: String,
    pub logo:       Option<String>,
    pub homepage:   Option<String>,
    pub country:    Option<String>,
    pub categories: Vec<String>,
}

#[derive(Default)]
struct CatalogCache {
    channels:   Vec<DiscoveredChannel>,
    fetched_at: Option<Instant>,
}

static CACHE: std::sync::OnceLock<Arc<RwLock<CatalogCache>>> = std::sync::OnceLock::new();

fn cache() -> &'static Arc<RwLock<CatalogCache>> {
    CACHE.get_or_init(|| Arc::new(RwLock::new(CatalogCache::default())))
}

const CACHE_TTL: Duration = Duration::from_secs(12 * 3600);

async fn refresh_catalog(http: &reqwest::Client) -> anyhow::Result<Vec<DiscoveredChannel>> {
    let channels: Vec<IptvChannel> = http
        .get("https://iptv-org.github.io/api/channels.json")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let streams: Vec<IptvStream> = http
        .get("https://iptv-org.github.io/api/streams.json")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    // Only keep https streams on named hosts (no literal IPs): raw-IP http
    // endpoints are almost always unauthorized third-party rebroadcasts,
    // which we refuse to surface.
    fn acceptable(url: &str) -> bool {
        let Ok(parsed) = url::Url::parse(url) else { return false };
        parsed.scheme() == "https"
            && matches!(parsed.host(), Some(url::Host::Domain(_)))
    }

    // First acceptable stream per channel id wins.
    let mut stream_by_channel: HashMap<&str, &str> = HashMap::new();
    for s in &streams {
        if let Some(ch) = s.channel.as_deref() {
            if acceptable(&s.url) {
                stream_by_channel.entry(ch).or_insert(s.url.as_str());
            }
        }
    }

    let joined: Vec<DiscoveredChannel> = channels
        .iter()
        .filter(|c| !c.is_nsfw)
        .filter_map(|ch| {
            let url = stream_by_channel.get(ch.id.as_str())?;
            Some(DiscoveredChannel {
                name:       ch.name.clone(),
                stream_url: url.to_string(),
                logo:       ch.logo.clone(),
                homepage:   ch.website.clone(),
                country:    ch.country.clone(),
                categories: ch.categories.clone(),
            })
        })
        .collect();
    Ok(joined)
}

/// Search the community catalogue by name / country code / category.
pub async fn discover(
    http:     &reqwest::Client,
    query:    &str,
    country:  Option<&str>,
    category: Option<&str>,
    limit:    usize,
) -> anyhow::Result<Vec<DiscoveredChannel>> {
    // Refresh the cache when stale (double-checked to avoid a thundering herd).
    let needs_refresh = {
        let guard = cache().read().await;
        guard.fetched_at.map(|t| t.elapsed() > CACHE_TTL).unwrap_or(true)
    };
    if needs_refresh {
        let mut guard = cache().write().await;
        if guard.fetched_at.map(|t| t.elapsed() > CACHE_TTL).unwrap_or(true) {
            match refresh_catalog(http).await {
                Ok(list) => {
                    tracing::info!(count = list.len(), "Catalogue TV iptv-org rafraîchi");
                    guard.channels = list;
                    guard.fetched_at = Some(Instant::now());
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Rafraîchissement du catalogue iptv-org échoué");
                    if guard.channels.is_empty() {
                        return Err(e);
                    }
                }
            }
        }
    }

    let q = query.trim().to_lowercase();
    let guard = cache().read().await;
    let results = guard
        .channels
        .iter()
        .filter(|c| q.is_empty() || c.name.to_lowercase().contains(&q))
        .filter(|c| country.map(|cc| c.country.as_deref() == Some(cc)).unwrap_or(true))
        .filter(|c| {
            category
                .map(|cat| c.categories.iter().any(|x| x.eq_ignore_ascii_case(cat)))
                .unwrap_or(true)
        })
        .take(limit)
        .cloned()
        .collect();
    Ok(results)
}
