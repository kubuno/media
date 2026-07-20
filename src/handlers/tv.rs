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

async fn favorite_set(state: &AppState, user_id: Uuid) -> Result<HashSet<Uuid>, MediaError> {
    let rows = sqlx::query!(
        "SELECT channel_id FROM media.tv_favorites WHERE user_id = $1",
        user_id
    )
    .fetch_all(&state.db)
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
    let search   = q.q.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let category = q.category.filter(|c| !c.is_empty());
    let mine     = q.mine.unwrap_or(false);

    let rows = sqlx::query!(
        r#"SELECT id, name, stream_url, homepage, logo, categories, country, language,
                  is_builtin, owner_id, click_count
           FROM media.tv_channels
           WHERE (is_builtin OR owner_id = $1)
             AND ($2::text  IS NULL OR name ILIKE '%' || $2 || '%')
             AND ($3::text  IS NULL OR $3 = ANY(categories))
             AND (NOT $4::bool OR owner_id = $1)
           ORDER BY is_builtin DESC, name"#,
        user.id,
        search,
        category,
        mine,
    )
    .fetch_all(&state.db)
    .await?;

    let favs = favorite_set(&state, user.id).await?;
    let channels: Vec<Value> = rows.into_iter().map(|r| json!({
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
        "is_favorite": favs.contains(&r.id),
        "click_count": r.click_count,
    })).collect();

    Ok(Json(json!({ "channels": channels })))
}

pub async fn list_categories(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query!(
        r#"SELECT c.cat AS "cat!", COUNT(*) AS "count!"
           FROM media.tv_channels t, unnest(t.categories) AS c(cat)
           WHERE t.is_builtin OR t.owner_id = $1
           GROUP BY c.cat ORDER BY COUNT(*) DESC, c.cat"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    let categories: Vec<Value> = rows.into_iter()
        .map(|r| json!({ "category": r.cat, "count": r.count }))
        .collect();
    Ok(Json(json!({ "categories": categories })))
}

pub async fn list_favorites(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows = sqlx::query!(
        r#"SELECT t.id, t.name, t.homepage, t.logo, t.categories, t.country, t.language,
                  t.is_builtin, t.owner_id, t.click_count
           FROM media.tv_favorites f
           JOIN media.tv_channels t ON t.id = f.channel_id
           WHERE f.user_id = $1
           ORDER BY f.created_at DESC"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    let channels: Vec<Value> = rows.into_iter().map(|r| json!({
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
        "is_favorite": true,
        "click_count": r.click_count,
    })).collect();
    Ok(Json(json!({ "channels": channels })))
}

pub async fn list_recent(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let favs = favorite_set(&state, user.id).await?;
    let rows = sqlx::query!(
        r#"SELECT t.id, t.name, t.homepage, t.logo, t.categories, t.country, t.language,
                  t.is_builtin, t.owner_id, t.click_count
           FROM media.tv_recent r
           JOIN media.tv_channels t ON t.id = r.channel_id
           WHERE r.user_id = $1
           ORDER BY r.played_at DESC
           LIMIT 30"#,
        user.id
    )
    .fetch_all(&state.db)
    .await?;
    let channels: Vec<Value> = rows.into_iter().map(|r| json!({
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
        "is_favorite": favs.contains(&r.id),
        "click_count": r.click_count,
    })).collect();
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

    let id: Uuid = sqlx::query_scalar!(
        r#"INSERT INTO media.tv_channels
             (name, stream_url, homepage, logo, categories, country, language, owner_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id"#,
        name,
        body.stream_url.trim(),
        body.homepage,
        body.logo,
        &categories,
        body.country,
        body.language,
        user.id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "ok": true, "id": id })))
}

pub async fn delete_channel(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let deleted = sqlx::query!(
        "DELETE FROM media.tv_channels WHERE id = $1 AND owner_id = $2 RETURNING id",
        id, user.id
    )
    .fetch_optional(&state.db)
    .await?;
    if deleted.is_none() {
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
    let removed = sqlx::query!(
        "DELETE FROM media.tv_favorites WHERE user_id = $1 AND channel_id = $2 RETURNING channel_id",
        user.id, id
    )
    .fetch_optional(&state.db)
    .await?;
    if removed.is_some() {
        return Ok(Json(json!({ "is_favorite": false })));
    }
    sqlx::query!(
        "INSERT INTO media.tv_favorites (user_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        user.id, id
    )
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "is_favorite": true })))
}

pub async fn record_play(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    sqlx::query!(
        r#"INSERT INTO media.tv_recent (user_id, channel_id) VALUES ($1, $2)
           ON CONFLICT (user_id, channel_id) DO UPDATE SET played_at = NOW()"#,
        user.id, id
    )
    .execute(&state.db)
    .await?;
    sqlx::query!(
        "UPDATE media.tv_channels SET click_count = click_count + 1 WHERE id = $1",
        id
    )
    .execute(&state.db)
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
    let row = sqlx::query!(
        "SELECT stream_url FROM media.tv_channels WHERE id = $1 AND (is_builtin OR owner_id = $2)",
        id, user.id
    )
    .fetch_optional(&state.db)
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
