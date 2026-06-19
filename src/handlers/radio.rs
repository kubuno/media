//! Web radio handlers: browse/search the station catalogue (builtin + user's
//! own), manage custom stations, favorites and recent history, discover new
//! stations via the public Radio Browser API, and proxy the live audio stream
//! (so the browser plays http/Icecast streams over the app's https origin
//! without mixed-content or CORS issues).

use std::collections::HashSet;

use axum::{
    body::Body,
    extract::{Extension, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    models::radio::{DiscoverQuery, ListStationsQuery, RadioStation, UpsertStationDto},
    state::AppState,
};

const UA: &str = "Kubuno-Media/0.1 (+https://kubuno.com)";

fn station_json(s: &RadioStation, favorite: bool) -> Value {
    json!({
        "id":          s.id,
        "name":        s.name,
        "stream_url":  format!("/api/v1/media/radio/stations/{}/stream", s.id),
        "homepage":    s.homepage,
        "favicon":     s.favicon,
        "tags":        s.tags,
        "country":     s.country,
        "language":    s.language,
        "codec":       s.codec,
        "bitrate":     s.bitrate,
        "is_builtin":  s.is_builtin,
        "is_custom":   s.owner_id.is_some(),
        "is_favorite": favorite,
        "click_count": s.click_count,
    })
}

async fn favorite_set(state: &AppState, user_id: Uuid) -> Result<HashSet<Uuid>, MediaError> {
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT station_id FROM media.radio_favorites WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// GET /radio/stations — list builtin + own stations, filtered.
pub async fn list_stations(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Query(q): Query<ListStationsQuery>,
) -> Result<Json<Value>, MediaError> {
    let limit = q.limit.unwrap_or(200).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    let stations: Vec<RadioStation> = sqlx::query_as(
        r#"SELECT id, name, stream_url, homepage, favicon, tags, country, language,
                  codec, bitrate, is_builtin, owner_id, click_count
           FROM media.radio_stations
           WHERE (is_builtin OR owner_id = $1)
             AND ($2::text IS NULL
                  OR name ILIKE '%' || $2 || '%'
                  OR EXISTS (SELECT 1 FROM unnest(tags) tg WHERE tg ILIKE '%' || $2 || '%'))
             AND ($3::text IS NULL OR $3 = ANY(tags))
             AND ($4::text IS NULL OR country = $4)
             AND ($5::bool IS NOT TRUE OR owner_id = $1)
           ORDER BY (owner_id IS NOT NULL) DESC, click_count DESC, name ASC
           LIMIT $6 OFFSET $7"#,
    )
    .bind(user.id)
    .bind(q.q.as_deref())
    .bind(q.tag.as_deref())
    .bind(q.country.as_deref())
    .bind(q.mine)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    let favs = favorite_set(&state, user.id).await?;
    let out: Vec<Value> = stations.iter().map(|s| station_json(s, favs.contains(&s.id))).collect();
    Ok(Json(json!({ "stations": out })))
}

/// GET /radio/tags — distinct tags with station counts (filter chips).
pub async fn list_tags(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        r#"SELECT tg AS tag, COUNT(*) AS n
           FROM media.radio_stations, unnest(tags) tg
           WHERE is_builtin OR owner_id = $1
           GROUP BY tg
           ORDER BY n DESC, tg ASC
           LIMIT 60"#,
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    let tags: Vec<Value> = rows.into_iter().map(|(tag, n)| json!({ "tag": tag, "count": n })).collect();
    Ok(Json(json!({ "tags": tags })))
}

/// GET /radio/favorites — the user's favorite stations.
pub async fn list_favorites(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let stations: Vec<RadioStation> = sqlx::query_as(
        r#"SELECT s.id, s.name, s.stream_url, s.homepage, s.favicon, s.tags, s.country,
                  s.language, s.codec, s.bitrate, s.is_builtin, s.owner_id, s.click_count
           FROM media.radio_favorites f
           JOIN media.radio_stations s ON s.id = f.station_id
           WHERE f.user_id = $1
           ORDER BY f.created_at DESC"#,
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    let out: Vec<Value> = stations.iter().map(|s| station_json(s, true)).collect();
    Ok(Json(json!({ "stations": out })))
}

/// GET /radio/recent — recently played stations.
pub async fn list_recent(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let stations: Vec<RadioStation> = sqlx::query_as(
        r#"SELECT s.id, s.name, s.stream_url, s.homepage, s.favicon, s.tags, s.country,
                  s.language, s.codec, s.bitrate, s.is_builtin, s.owner_id, s.click_count
           FROM media.radio_recent rr
           JOIN media.radio_stations s ON s.id = rr.station_id
           WHERE rr.user_id = $1
           ORDER BY rr.played_at DESC
           LIMIT 30"#,
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    let favs = favorite_set(&state, user.id).await?;
    let out: Vec<Value> = stations.iter().map(|s| station_json(s, favs.contains(&s.id))).collect();
    Ok(Json(json!({ "stations": out })))
}

/// POST /radio/stations — add a custom station.
pub async fn create_station(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(dto): Json<UpsertStationDto>,
) -> Result<Json<Value>, MediaError> {
    if dto.name.trim().is_empty() || dto.stream_url.trim().is_empty() {
        return Err(MediaError::Validation("Nom et URL du flux requis".into()));
    }
    if !dto.stream_url.starts_with("http") {
        return Err(MediaError::Validation("URL de flux invalide".into()));
    }
    let station: RadioStation = sqlx::query_as(
        r#"INSERT INTO media.radio_stations
             (name, stream_url, homepage, favicon, tags, country, language, codec, bitrate, is_builtin, owner_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10)
           RETURNING id, name, stream_url, homepage, favicon, tags, country, language,
                     codec, bitrate, is_builtin, owner_id, click_count"#,
    )
    .bind(dto.name.trim())
    .bind(dto.stream_url.trim())
    .bind(dto.homepage)
    .bind(dto.favicon)
    .bind(&dto.tags)
    .bind(dto.country)
    .bind(dto.language)
    .bind(dto.codec)
    .bind(dto.bitrate)
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(station_json(&station, false)))
}

/// PATCH /radio/stations/:id — update a custom station (owner only).
pub async fn update_station(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(dto): Json<UpsertStationDto>,
) -> Result<Json<Value>, MediaError> {
    let station: Option<RadioStation> = sqlx::query_as(
        r#"UPDATE media.radio_stations SET
             name = $1, stream_url = $2, homepage = $3, favicon = $4, tags = $5,
             country = $6, language = $7, codec = $8, bitrate = $9, updated_at = NOW()
           WHERE id = $10 AND owner_id = $11
           RETURNING id, name, stream_url, homepage, favicon, tags, country, language,
                     codec, bitrate, is_builtin, owner_id, click_count"#,
    )
    .bind(dto.name.trim())
    .bind(dto.stream_url.trim())
    .bind(dto.homepage)
    .bind(dto.favicon)
    .bind(&dto.tags)
    .bind(dto.country)
    .bind(dto.language)
    .bind(dto.codec)
    .bind(dto.bitrate)
    .bind(id)
    .bind(user.id)
    .fetch_optional(&state.db)
    .await?;
    let station = station.ok_or_else(|| MediaError::NotFound(format!("Station {id}")))?;
    Ok(Json(station_json(&station, false)))
}

/// DELETE /radio/stations/:id — remove a custom station (owner only).
pub async fn delete_station(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, MediaError> {
    let res = sqlx::query("DELETE FROM media.radio_stations WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(user.id)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(MediaError::NotFound(format!("Station {id}")));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// POST /radio/stations/:id/favorite — toggle favorite.
pub async fn toggle_favorite(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    let exists: Option<(bool,)> = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM media.radio_favorites WHERE user_id = $1 AND station_id = $2)",
    )
    .bind(user.id)
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    let is_fav = exists.map(|e| e.0).unwrap_or(false);

    if is_fav {
        sqlx::query("DELETE FROM media.radio_favorites WHERE user_id = $1 AND station_id = $2")
            .bind(user.id).bind(id).execute(&state.db).await?;
        Ok(Json(json!({ "favorite": false })))
    } else {
        sqlx::query(
            "INSERT INTO media.radio_favorites (user_id, station_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(user.id).bind(id).execute(&state.db).await?;
        Ok(Json(json!({ "favorite": true })))
    }
}

/// POST /radio/stations/:id/play — record a play (recent + click count).
pub async fn record_play(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    sqlx::query(
        r#"INSERT INTO media.radio_recent (user_id, station_id) VALUES ($1, $2)
           ON CONFLICT (user_id, station_id) DO UPDATE SET played_at = NOW()"#,
    )
    .bind(user.id).bind(id).execute(&state.db).await?;
    sqlx::query("UPDATE media.radio_stations SET click_count = click_count + 1 WHERE id = $1")
        .bind(id).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

/// GET /radio/discover?q=… — search the public Radio Browser directory.
pub async fn discover(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthUser>,
    Query(q): Query<DiscoverQuery>,
) -> Result<Json<Value>, MediaError> {
    let limit = q.limit.unwrap_or(40).clamp(1, 100);
    let limit_str = limit.to_string();
    let resp = state.http
        .get("https://de1.api.radio-browser.info/json/stations/search")
        .query(&[
            ("name", q.q.as_str()),
            ("limit", limit_str.as_str()),
            ("hidebroken", "true"),
            ("order", "clickcount"),
            ("reverse", "true"),
        ])
        .header(header::USER_AGENT, UA)
        .send()
        .await
        .map_err(|e| MediaError::Upstream(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(MediaError::Upstream(format!("Radio Browser {}", resp.status())));
    }
    let arr: Vec<Value> = resp.json().await.map_err(|e| MediaError::Upstream(e.to_string()))?;
    let results: Vec<Value> = arr.iter().map(|s| json!({
        "name":       s.get("name").and_then(|v| v.as_str()).unwrap_or(""),
        "stream_url": s.get("url_resolved").and_then(|v| v.as_str()).or_else(|| s.get("url").and_then(|v| v.as_str())).unwrap_or(""),
        "homepage":   s.get("homepage").and_then(|v| v.as_str()),
        "favicon":    s.get("favicon").and_then(|v| v.as_str()).filter(|f| !f.is_empty()),
        "country":    s.get("country").and_then(|v| v.as_str()),
        "language":   s.get("language").and_then(|v| v.as_str()),
        "codec":      s.get("codec").and_then(|v| v.as_str()),
        "bitrate":    s.get("bitrate").and_then(|v| v.as_i64()),
        "tags":       s.get("tags").and_then(|v| v.as_str()).map(|t| t.split(',').filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_default(),
    })).collect();
    Ok(Json(json!({ "results": results })))
}

/// GET /radio/:id/stream — proxy the live audio stream through the backend.
pub async fn stream(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Response, MediaError> {
    let url: Option<(String,)> = sqlx::query_as(
        "SELECT stream_url FROM media.radio_stations WHERE id = $1 AND (is_builtin OR owner_id = $2)",
    )
    .bind(id)
    .bind(user.id)
    .fetch_optional(&state.db)
    .await?;
    let url = url.ok_or_else(|| MediaError::NotFound(format!("Station {id}")))?.0;

    let upstream = state.http.get(&url)
        .header(header::USER_AGENT, UA)
        .header(header::ACCEPT, "*/*")
        .send()
        .await
        .map_err(|e| MediaError::Upstream(e.to_string()))?;

    if !upstream.status().is_success() {
        return Err(MediaError::Upstream(format!("Flux {} ({})", url, upstream.status())));
    }

    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("audio/mpeg")
        .to_string();

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
