//! Web TV — live television channels (HLS), mirroring the web radio feature:
//! builtin curated channels + user channels + favorites + recents + discovery
//! (iptv-org community catalogue) + an HLS proxy that rewrites manifests so
//! playback works same-origin (no CORS / mixed-content issues).

use axum::{
    body::Body,
    extract::{Extension, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use kubuno_db::{dialect::Assign, params};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;

use crate::{
    errors::MediaError, middleware::auth::AuthUser, services::tv_catalog, state::AppState,
};

const PROXY_PREFIX: &str = "/api/v1/media/tv/proxy?u=";

fn encode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

// ── Listing ───────────────────────────────────────────────────────────────────

// Row shapes for the runtime queries (one binary, three engines: kubuno-db).
// `categories` is a JSON array column (was `TEXT[]`), read with `#[sqlx(json)]`.
#[derive(sqlx::FromRow)]
struct ChannelRow {
    id:           Uuid,
    name:         String,
    homepage:     Option<String>,
    logo:         Option<String>,
    #[sqlx(json)]
    categories:   Vec<String>,
    country:      Option<String>,
    language:     Option<String>,
    is_builtin:   bool,
    owner_id:     Option<Uuid>,
    click_count:  i64,
}

fn channel_json(r: &ChannelRow, favorite: bool) -> Value {
    json!({
        "id":          r.id,
        "name":        r.name,
        "stream_url":  format!("/api/v1/media/tv/channels/{}/stream", r.id),
        "homepage":    r.homepage,
        "logo":        r.logo,
        "categories":  r.categories,
        "country":     r.country,
        "language":    r.language,
        "is_builtin":  r.is_builtin,
        "is_custom":   r.owner_id.is_some(),
        "is_favorite": favorite,
        "click_count": r.click_count,
    })
}

async fn favorite_set(state: &AppState, user_id: Uuid) -> Result<HashSet<Uuid>, MediaError> {
    #[derive(sqlx::FromRow)]
    struct FavRow {
        channel_id: Uuid,
    }
    let rows = state
        .db
        .fetch_all_as::<FavRow>(
            "SELECT channel_id FROM media.tv_favorites WHERE user_id = $1",
            params![user_id],
        )
        .await?;
    Ok(rows.into_iter().map(|r| r.channel_id).collect())
}

#[derive(Deserialize)]
pub struct ListChannelsQuery {
    pub q:        Option<String>,
    pub category: Option<String>,
    pub mine:     Option<bool>,
}

pub async fn list_channels(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Query(q): Query<ListChannelsQuery>,
) -> Result<Json<Value>, MediaError> {
    let search   = q.q.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
    let category = q.category.filter(|c| !c.is_empty());
    let mine     = q.mine.unwrap_or(false);

    // `%` alone matches every row, so a single query text covers the filtered
    // and unfiltered cases for the name search (no `$n IS NULL OR ...` guard
    // needed for it).
    let pattern = match &search {
        Some(s) => format!("%{s}%"),
        None => "%".to_string(),
    };

    // `categories` is now a JSON array column: `$3 = ANY(categories)` becomes
    // the portable containment test below. It has no "matches everything"
    // literal like `%`, so its optional filter binds its value twice under
    // two distinct placeholders (once for the `IS NULL` guard, once for
    // actual use) — placeholders are never reused.
    let category_contains = state.db.backend().json_array_contains("categories", 4);
    let sql = format!(
        r#"SELECT id, name, homepage, logo, categories, country, language,
                  is_builtin, owner_id, click_count
           FROM media.tv_channels
           WHERE (is_builtin OR owner_id = $1)
             AND LOWER(name) LIKE $2
             AND ($3 IS NULL OR {category_contains})
             AND (NOT $5 OR owner_id = $6)
           ORDER BY is_builtin DESC, name"#
    );
    let rows = state
        .db
        .fetch_all_as::<ChannelRow>(
            &sql,
            params![user.id, pattern, category.clone(), category, mine, user.id],
        )
        .await?;

    let favs = favorite_set(&state, user.id).await?;
    let channels: Vec<Value> =
        rows.iter().map(|r| channel_json(r, favs.contains(&r.id))).collect();

    Ok(Json(json!({ "channels": channels })))
}

pub async fn list_categories(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    // `categories` is now a JSON array column: there is no portable `unnest()`.
    // Fetch each visible channel's categories and aggregate the facet counts
    // here in Rust instead of in SQL.
    #[derive(sqlx::FromRow)]
    struct CategoriesRow {
        #[sqlx(json)]
        categories: Vec<String>,
    }
    let rows = state
        .db
        .fetch_all_as::<CategoriesRow>(
            "SELECT categories FROM media.tv_channels WHERE is_builtin OR owner_id = $1",
            params![user.id],
        )
        .await?;

    let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for row in rows {
        for cat in row.categories {
            *counts.entry(cat).or_insert(0) += 1;
        }
    }
    let mut counted: Vec<(String, i64)> = counts.into_iter().collect();
    counted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    let categories: Vec<Value> = counted
        .into_iter()
        .map(|(category, count)| json!({ "category": category, "count": count }))
        .collect();
    Ok(Json(json!({ "categories": categories })))
}

pub async fn list_favorites(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = state
        .db
        .fetch_all_as::<ChannelRow>(
            r#"SELECT t.id, t.name, t.homepage, t.logo, t.categories, t.country, t.language,
                      t.is_builtin, t.owner_id, t.click_count
               FROM media.tv_favorites f
               JOIN media.tv_channels t ON t.id = f.channel_id
               WHERE f.user_id = $1
               ORDER BY f.created_at DESC"#,
            params![user.id],
        )
        .await?;
    let channels: Vec<Value> = rows.iter().map(|r| channel_json(r, true)).collect();
    Ok(Json(json!({ "channels": channels })))
}

pub async fn list_recent(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let favs = favorite_set(&state, user.id).await?;
    let rows = state
        .db
        .fetch_all_as::<ChannelRow>(
            r#"SELECT t.id, t.name, t.homepage, t.logo, t.categories, t.country, t.language,
                      t.is_builtin, t.owner_id, t.click_count
               FROM media.tv_recent r
               JOIN media.tv_channels t ON t.id = r.channel_id
               WHERE r.user_id = $1
               ORDER BY r.played_at DESC
               LIMIT 30"#,
            params![user.id],
        )
        .await?;
    let channels: Vec<Value> =
        rows.iter().map(|r| channel_json(r, favs.contains(&r.id))).collect();
    Ok(Json(json!({ "channels": channels })))
}

// ── Custom channels CRUD ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ChannelBody {
    pub name:       String,
    pub stream_url: String,
    pub homepage:   Option<String>,
    pub logo:       Option<String>,
    pub categories: Option<Vec<String>>,
    pub country:    Option<String>,
    pub language:   Option<String>,
}

fn validate_stream_url(url: &str) -> Result<(), MediaError> {
    let parsed = url::Url::parse(url)
        .map_err(|_| MediaError::Validation("URL de flux invalide".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(MediaError::Validation("Seuls les flux http(s) sont acceptés".into()));
    }
    Ok(())
}

pub async fn create_channel(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(body): Json<ChannelBody>,
) -> Result<Json<Value>, MediaError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(MediaError::Validation("Nom de chaîne requis".into()));
    }
    validate_stream_url(&body.stream_url)?;
    let categories = body.categories.unwrap_or_default();

    // No `RETURNING` (not portable): mint the id in Rust and bind it.
    let id = kubuno_db::new_id();
    state
        .db
        .execute(
            r#"INSERT INTO media.tv_channels
                 (id, name, stream_url, homepage, logo, categories, country, language, owner_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
            params![
                id,
                name,
                body.stream_url.trim(),
                body.homepage,
                body.logo,
                categories,
                body.country,
                body.language,
                user.id,
            ],
        )
        .await?;

    Ok(Json(json!({ "ok": true, "id": id })))
}

pub async fn delete_channel(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let deleted = state
        .db
        .execute(
            "DELETE FROM media.tv_channels WHERE id = $1 AND owner_id = $2",
            params![id, user.id],
        )
        .await?;
    if deleted == 0 {
        return Err(MediaError::NotFound(format!("Chaîne {id}")));
    }
    Ok(Json(json!({ "ok": true })))
}

// ── Favorites & recents ───────────────────────────────────────────────────────

pub async fn toggle_favorite(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let removed = state
        .db
        .execute(
            "DELETE FROM media.tv_favorites WHERE user_id = $1 AND channel_id = $2",
            params![user.id, id],
        )
        .await?;
    if removed > 0 {
        return Ok(Json(json!({ "is_favorite": false })));
    }
    let sql = format!(
        "INSERT {}INTO media.tv_favorites (user_id, channel_id) VALUES ($1, $2){}",
        state.db.backend().insert_ignore_prefix(),
        state.db.backend().on_conflict_do_nothing(&["user_id", "channel_id"]),
    );
    state.db.execute(&sql, params![user.id, id]).await?;
    Ok(Json(json!({ "is_favorite": true })))
}

pub async fn record_play(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    // `ON CONFLICT (...) DO UPDATE SET played_at = NOW()` — bind a Rust
    // timestamp as the incoming value instead of relying on `NOW()`.
    let played_at = chrono::Utc::now();
    let clause = state.db.backend().upsert(
        "media.tv_recent",
        &["user_id", "channel_id"],
        &[Assign::Incoming("played_at")],
    );
    let sql =
        format!("INSERT INTO media.tv_recent (user_id, channel_id, played_at) VALUES ($1, $2, $3){clause}");
    state.db.execute(&sql, params![user.id, id, played_at]).await?;

    state
        .db
        .execute(
            "UPDATE media.tv_channels SET click_count = click_count + 1 WHERE id = $1",
            params![id],
        )
        .await?;
    Ok(Json(json!({ "ok": true })))
}

// ── Discovery (iptv-org) ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct DiscoverQuery {
    pub q:        String,
    pub country:  Option<String>,
    pub category: Option<String>,
    pub limit:    Option<usize>,
}

pub async fn discover(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Query(q): Query<DiscoverQuery>,
) -> Result<Json<Value>, MediaError> {
    let limit = q.limit.unwrap_or(40).clamp(1, 100);
    let results = tv_catalog::discover(
        &state.http,
        &q.q,
        q.country.as_deref().filter(|c| !c.is_empty()),
        q.category.as_deref().filter(|c| !c.is_empty()),
        limit,
    )
    .await
    .map_err(|e| MediaError::Upstream(format!("Catalogue TV: {e}")))?;

    let results: Vec<Value> = results.into_iter().map(|c| json!({
        "name":       c.name,
        "stream_url": c.stream_url,
        "logo":       c.logo,
        "homepage":   c.homepage,
        "country":    c.country,
        "categories": c.categories,
    })).collect();
    Ok(Json(json!({ "results": results })))
}

// ── HLS proxy ─────────────────────────────────────────────────────────────────
// Live TV streams are HLS: a manifest referencing sub-playlists/segments on
// the broadcaster's CDN. Browsers need same-origin (or CORS) access, so we
// proxy everything and rewrite manifest URIs to come back through us.

/// Refuse URLs that point inside the private network (SSRF guard).
fn ensure_public_http(url: &url::Url) -> Result<(), MediaError> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(MediaError::Validation("Schéma d'URL non autorisé".into()));
    }
    let forbidden = match url.host() {
        Some(url::Host::Domain(d)) => {
            let d = d.to_lowercase();
            d == "localhost" || d.ends_with(".local") || d.ends_with(".internal")
        }
        Some(url::Host::Ipv4(ip)) => {
            ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified()
        }
        Some(url::Host::Ipv6(ip)) => ip.is_loopback() || ip.is_unspecified(),
        None => true,
    };
    if forbidden {
        return Err(MediaError::Validation("Hôte de flux non autorisé".into()));
    }
    Ok(())
}

fn proxied_url(abs: &url::Url) -> String {
    format!("{PROXY_PREFIX}{}", encode(abs.as_str()))
}

/// Rewrite every URI of an HLS manifest to go through the proxy.
fn rewrite_manifest(base: &url::Url, body: &str) -> String {
    let uri_attr = regex::Regex::new(r#"URI="([^"]+)""#).expect("regex valide");
    body.lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                line.to_string()
            } else if trimmed.starts_with('#') {
                // Rewrite URI="..." attributes (EXT-X-KEY, EXT-X-MEDIA, EXT-X-MAP…)
                uri_attr
                    .replace_all(line, |caps: &regex::Captures| {
                        match base.join(&caps[1]) {
                            Ok(abs) => format!(r#"URI="{}""#, proxied_url(&abs)),
                            Err(_) => caps[0].to_string(),
                        }
                    })
                    .to_string()
            } else {
                match base.join(trimmed) {
                    Ok(abs) => proxied_url(&abs),
                    Err(_) => line.to_string(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_manifest(url: &url::Url, content_type: &str) -> bool {
    content_type.contains("mpegurl")
        || content_type.contains("x-mpegURL")
        || url.path().to_lowercase().ends_with(".m3u8")
}

/// Fetch a remote HLS resource; manifests are rewritten, segments streamed.
async fn proxy_fetch(state: &AppState, raw_url: &str) -> Result<Response, MediaError> {
    let parsed = url::Url::parse(raw_url)
        .map_err(|_| MediaError::Validation("URL invalide".into()))?;
    ensure_public_http(&parsed)?;

    let upstream = state.http
        .get(parsed.clone())
        .header(header::USER_AGENT, "Mozilla/5.0 (X11; Linux x86_64) KubunoMedia/0.1")
        .header(header::ACCEPT, "*/*")
        .send()
        .await
        .map_err(|e| MediaError::Upstream(e.to_string()))?;

    if !upstream.status().is_success() {
        return Err(MediaError::Upstream(format!("Flux {} ({})", parsed, upstream.status())));
    }

    // The final URL (after redirects) is the base for relative manifest URIs.
    let final_url = upstream.url().clone();
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    if is_manifest(&final_url, &content_type) {
        let text = upstream.text().await.map_err(|e| MediaError::Upstream(e.to_string()))?;
        let rewritten = rewrite_manifest(&final_url, &text);
        return Ok((
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/vnd.apple.mpegurl".to_string()),
                (header::CACHE_CONTROL, "no-store".to_string()),
            ],
            rewritten,
        )
            .into_response());
    }

    let body = Body::from_stream(upstream.bytes_stream());
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        body,
    )
        .into_response())
}

/// GET /tv/channels/:id/stream — entry point: proxy the channel's manifest.
pub async fn stream(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    _headers: HeaderMap,
) -> Result<Response, MediaError> {
    #[derive(sqlx::FromRow)]
    struct StreamUrlRow {
        stream_url: String,
    }
    let row = state
        .db
        .fetch_optional_as::<StreamUrlRow>(
            "SELECT stream_url FROM media.tv_channels WHERE id = $1 AND (is_builtin OR owner_id = $2)",
            params![id, user.id],
        )
        .await?
        .ok_or_else(|| MediaError::NotFound(format!("Chaîne {id}")))?;

    proxy_fetch(&state, &row.stream_url).await
}

#[derive(Deserialize)]
pub struct ProxyQuery {
    pub u: String,
}

/// GET /tv/proxy?u=… — proxy a manifest-referenced resource (sub-playlist,
/// segment, key). URLs only ever come from manifests we rewrote ourselves.
pub async fn proxy(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Query(q): Query<ProxyQuery>,
) -> Result<Response, MediaError> {
    proxy_fetch(&state, &q.u).await
}
