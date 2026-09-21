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
use kubuno_db::{dialect::Assign, params};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    errors::MediaError,
    middleware::auth::AuthUser,
    models::radio::{DiscoverQuery, ListStationsQuery, RadioStation, UpsertStationDto},
    state::AppState,
};

const UA: &str = "Kubuno-Media/0.1 (+https://kubuno.com)";

const STATION_COLUMNS: &str = r#"id, name, stream_url, homepage, favicon, tags, country, language,
                  codec, bitrate, is_builtin, owner_id, click_count"#;

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
    #[derive(sqlx::FromRow)]
    struct FavRow {
        station_id: Uuid,
    }
    let rows = state
        .db
        .fetch_all_as::<FavRow>(
            "SELECT station_id FROM media.radio_favorites WHERE user_id = $1",
            params![user_id],
        )
        .await?;
    Ok(rows.into_iter().map(|r| r.station_id).collect())
}

/// GET /radio/stations — list builtin + own stations, filtered.
pub async fn list_stations(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Query(q): Query<ListStationsQuery>,
) -> Result<Json<Value>, MediaError> {
    let limit = q.limit.unwrap_or(200).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    let tag = q.tag.filter(|t| !t.is_empty());
    let country = q.country.filter(|c| !c.is_empty());
    let mine = q.mine.unwrap_or(false);
    let search = q.q.as_deref().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());

    // `tags` is now a JSON array column: `$3 = ANY(tags)` becomes the portable
    // containment test below. Every optional filter binds its value twice
    // under two distinct placeholders (once for the `IS NULL` guard, once for
    // actual use) — placeholders are never reused.
    let tag_contains = state.db.backend().json_array_contains("tags", 3);
    let sql = format!(
        r#"SELECT {STATION_COLUMNS}
           FROM media.radio_stations
           WHERE (is_builtin OR owner_id = $1)
             AND ($2 IS NULL OR {tag_contains})
             AND ($4 IS NULL OR country = $5)
             AND (NOT $6 OR owner_id = $7)
           ORDER BY (owner_id IS NOT NULL) DESC, click_count DESC, name ASC"#
    );
    let mut stations: Vec<RadioStation> = state
        .db
        .fetch_all_as(&sql, params![user.id, tag.clone(), tag, country.clone(), country, mine, user.id])
        .await?;

    // Free-text `q` matches the station name OR any of its tags,
    // case-insensitively. A substring test over a JSON array's elements has
    // no single portable SQL form (the old `EXISTS (SELECT 1 FROM
    // unnest(tags) tg WHERE tg ILIKE …)`), so — unlike the DB-side filters
    // above — it is applied here in Rust, over the filtered set, and
    // LIMIT/OFFSET are then applied to the resulting Vec instead of to the
    // SQL query. The catalogue (curated builtin stations + one user's own) is
    // small enough for this to be cheap; note the behaviour change if it ever
    // grows large enough to matter.
    if let Some(needle) = &search {
        stations.retain(|s| {
            s.name.to_lowercase().contains(needle.as_str())
                || s.tags.iter().any(|t| t.to_lowercase().contains(needle.as_str()))
        });
    }
    let stations: Vec<RadioStation> =
        stations.into_iter().skip(offset as usize).take(limit as usize).collect();

    let favs = favorite_set(&state, user.id).await?;
    let out: Vec<Value> = stations.iter().map(|s| station_json(s, favs.contains(&s.id))).collect();
    Ok(Json(json!({ "stations": out })))
}

/// GET /radio/tags — distinct tags with station counts (filter chips).
pub async fn list_tags(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    // `tags` is now a JSON array column: there is no portable `unnest()`.
    // Fetch each visible station's tags and aggregate the facet counts here
    // in Rust instead of in SQL.
    #[derive(sqlx::FromRow)]
    struct TagsRow {
        #[sqlx(json)]
        tags: Vec<String>,
    }
    let rows = state
        .db
        .fetch_all_as::<TagsRow>(
            "SELECT tags FROM media.radio_stations WHERE is_builtin OR owner_id = $1",
            params![user.id],
        )
        .await?;

    let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for row in rows {
        for tag in row.tags {
            *counts.entry(tag).or_insert(0) += 1;
        }
    }
    let mut counted: Vec<(String, i64)> = counts.into_iter().collect();
    counted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    counted.truncate(60);

    let tags: Vec<Value> =
        counted.into_iter().map(|(tag, n)| json!({ "tag": tag, "count": n })).collect();
    Ok(Json(json!({ "tags": tags })))
}

/// GET /radio/favorites — the user's favorite stations.
pub async fn list_favorites(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let stations: Vec<RadioStation> = state
        .db
        .fetch_all_as(
            r#"SELECT s.id, s.name, s.stream_url, s.homepage, s.favicon, s.tags, s.country,
                      s.language, s.codec, s.bitrate, s.is_builtin, s.owner_id, s.click_count
               FROM media.radio_favorites f
               JOIN media.radio_stations s ON s.id = f.station_id
               WHERE f.user_id = $1
               ORDER BY f.created_at DESC"#,
            params![user.id],
        )
        .await?;
    let out: Vec<Value> = stations.iter().map(|s| station_json(s, true)).collect();
    Ok(Json(json!({ "stations": out })))
}

/// GET /radio/recent — recently played stations.
pub async fn list_recent(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<Value>, MediaError> {
    let stations: Vec<RadioStation> = state
        .db
        .fetch_all_as(
            r#"SELECT s.id, s.name, s.stream_url, s.homepage, s.favicon, s.tags, s.country,
                      s.language, s.codec, s.bitrate, s.is_builtin, s.owner_id, s.click_count
               FROM media.radio_recent rr
               JOIN media.radio_stations s ON s.id = rr.station_id
               WHERE rr.user_id = $1
               ORDER BY rr.played_at DESC
               LIMIT 30"#,
            params![user.id],
        )
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

    // No `RETURNING` (not portable): mint the id in Rust, insert, then
    // reselect the row.
    let id = kubuno_db::new_id();
    state
        .db
        .execute(
            r#"INSERT INTO media.radio_stations
                 (id, name, stream_url, homepage, favicon, tags, country, language, codec, bitrate, is_builtin, owner_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11)"#,
            params![
                id,
                dto.name.trim(),
                dto.stream_url.trim(),
                dto.homepage,
                dto.favicon,
                dto.tags,
                dto.country,
                dto.language,
                dto.codec,
                dto.bitrate,
                user.id,
            ],
        )
        .await?;

    let station = state
        .db
        .fetch_one_as::<RadioStation>(
            &format!("SELECT {STATION_COLUMNS} FROM media.radio_stations WHERE id = $1"),
            params![id],
        )
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
    // `updated_at` is no longer set here: the engine's trigger/default
    // maintains it.
    let updated = state
        .db
        .execute(
            r#"UPDATE media.radio_stations SET
                 name = $1, stream_url = $2, homepage = $3, favicon = $4, tags = $5,
                 country = $6, language = $7, codec = $8, bitrate = $9
               WHERE id = $10 AND owner_id = $11"#,
            params![
                dto.name.trim(),
                dto.stream_url.trim(),
                dto.homepage,
                dto.favicon,
                dto.tags,
                dto.country,
                dto.language,
                dto.codec,
                dto.bitrate,
                id,
                user.id,
            ],
        )
        .await?;
    if updated == 0 {
        return Err(MediaError::NotFound(format!("Station {id}")));
    }

    let station = state
        .db
        .fetch_one_as::<RadioStation>(
            &format!("SELECT {STATION_COLUMNS} FROM media.radio_stations WHERE id = $1"),
            params![id],
        )
        .await?;
    Ok(Json(station_json(&station, false)))
}

/// DELETE /radio/stations/:id — remove a custom station (owner only).
pub async fn delete_station(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, MediaError> {
    let deleted = state
        .db
        .execute(
            "DELETE FROM media.radio_stations WHERE id = $1 AND owner_id = $2",
            params![id, user.id],
        )
        .await?;
    if deleted == 0 {
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
    // `SELECT EXISTS(...)` decodes as a boolean on PostgreSQL only (an integer
    // on MySQL/SQLite); a presence probe with `LIMIT 1` is portable instead.
    let is_fav = state
        .db
        .fetch_optional_scalar::<i32>(
            "SELECT 1 FROM media.radio_favorites WHERE user_id = $1 AND station_id = $2 LIMIT 1",
            params![user.id, id],
        )
        .await?
        .is_some();

    if is_fav {
        state
            .db
            .execute(
                "DELETE FROM media.radio_favorites WHERE user_id = $1 AND station_id = $2",
                params![user.id, id],
            )
            .await?;
        Ok(Json(json!({ "favorite": false })))
    } else {
        let sql = format!(
            "INSERT {}INTO media.radio_favorites (user_id, station_id) VALUES ($1, $2){}",
            state.db.backend().insert_ignore_prefix(),
            state.db.backend().on_conflict_do_nothing(&["user_id", "station_id"]),
        );
        state.db.execute(&sql, params![user.id, id]).await?;
        Ok(Json(json!({ "favorite": true })))
    }
}

/// POST /radio/stations/:id/play — record a play (recent + click count).
pub async fn record_play(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, MediaError> {
    // `ON CONFLICT (...) DO UPDATE SET played_at = NOW()` — bind a Rust
    // timestamp as the incoming value instead of relying on `NOW()`.
    let played_at = chrono::Utc::now();
    let clause = state.db.backend().upsert(
        "media.radio_recent",
        &["user_id", "station_id"],
        &[Assign::Incoming("played_at")],
    );
    let sql = format!(
        "INSERT INTO media.radio_recent (user_id, station_id, played_at) VALUES ($1, $2, $3){clause}"
    );
    state.db.execute(&sql, params![user.id, id, played_at]).await?;

    state
        .db
        .execute(
            "UPDATE media.radio_stations SET click_count = click_count + 1 WHERE id = $1",
            params![id],
        )
        .await?;
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
    #[derive(sqlx::FromRow)]
    struct StreamUrlRow {
        stream_url: String,
    }
    let row = state
        .db
        .fetch_optional_as::<StreamUrlRow>(
            "SELECT stream_url FROM media.radio_stations WHERE id = $1 AND (is_builtin OR owner_id = $2)",
            params![id, user.id],
        )
        .await?;
    let url = row.ok_or_else(|| MediaError::NotFound(format!("Station {id}")))?.stream_url;

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
