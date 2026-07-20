use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::services::{covers, ffprobe, nfo, scanner};
use crate::config::Settings;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

// ── Artist / Album resolution helpers ────────────────────────────────────────

async fn resolve_artist(
    db:        &PgPool,
    lib_id:    Uuid,
    name:      &str,
    cache:     &mut HashMap<String, Uuid>,
) -> Result<Uuid> {
    let key = name.to_lowercase();
    if let Some(&id) = cache.get(&key) {
        return Ok(id);
    }
    let existing: Option<Uuid> = sqlx::query_scalar!(
        "SELECT id FROM media.artists WHERE library_id = $1 AND lower(name) = lower($2) LIMIT 1",
        lib_id, name
    )
    .fetch_optional(db)
    .await?;

    let id = if let Some(id) = existing {
        id
    } else {
        sqlx::query_scalar!(
            r#"INSERT INTO media.artists (library_id, name) VALUES ($1, $2)
               ON CONFLICT (library_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
               RETURNING id"#,
            lib_id, name
        )
        .fetch_one(db)
        .await?
    };
    cache.insert(key, id);
    Ok(id)
}

async fn resolve_album(
    db:        &PgPool,
    lib_id:    Uuid,
    title:     &str,
    artist_id: Option<Uuid>,
    cache:     &mut HashMap<(String, Option<Uuid>), Uuid>,
) -> Result<Uuid> {
    let key = (title.to_lowercase(), artist_id);
    if let Some(&id) = cache.get(&key) {
        return Ok(id);
    }
    let existing: Option<Uuid> = match artist_id {
        Some(aid) => sqlx::query_scalar!(
            "SELECT id FROM media.albums WHERE library_id=$1 AND artist_id=$2 AND lower(title)=lower($3) LIMIT 1",
            lib_id, aid, title
        ).fetch_optional(db).await?,
        None => sqlx::query_scalar!(
            "SELECT id FROM media.albums WHERE library_id=$1 AND artist_id IS NULL AND lower(title)=lower($2) LIMIT 1",
            lib_id, title
        ).fetch_optional(db).await?,
    };

    let id = if let Some(id) = existing {
        id
    } else {
        match artist_id {
            Some(aid) => sqlx::query_scalar!(
                r#"INSERT INTO media.albums (library_id, artist_id, title) VALUES ($1,$2,$3)
                   ON CONFLICT (library_id, artist_id, lower(title))
                       WHERE artist_id IS NOT NULL
                   DO UPDATE SET title = EXCLUDED.title
                   RETURNING id"#,
                lib_id, aid, title
            ).fetch_one(db).await?,
            None => sqlx::query_scalar!(
                r#"INSERT INTO media.albums (library_id, artist_id, title) VALUES ($1, NULL, $2)
                   ON CONFLICT (library_id, lower(title))
                       WHERE artist_id IS NULL
                   DO UPDATE SET title = EXCLUDED.title
                   RETURNING id"#,
                lib_id, title
            ).fetch_one(db).await?,
        }
    };
    cache.insert(key, id);
    Ok(id)
}

async fn refresh_audio_counts(db: &PgPool, library_id: Uuid) -> Result<()> {
    sqlx::query!(
        r#"UPDATE media.artists
           SET track_count = (SELECT COUNT(*) FROM media.tracks WHERE artist_id = media.artists.id),
               album_count = (SELECT COUNT(DISTINCT album_id) FROM media.tracks
                              WHERE artist_id = media.artists.id AND album_id IS NOT NULL)
           WHERE library_id = $1"#,
        library_id
    )
    .execute(db)
    .await?;

    sqlx::query!(
        r#"UPDATE media.albums
           SET track_count   = (SELECT COUNT(*)    FROM media.tracks WHERE album_id = media.albums.id),
               duration_secs = COALESCE((SELECT SUM(duration_secs) FROM media.tracks WHERE album_id = media.albums.id), 0)
           WHERE library_id = $1"#,
        library_id
    )
    .execute(db)
    .await?;

    Ok(())
}

pub async fn run_scan(
    db:           &PgPool,
    settings:     &Arc<Settings>,
    library_id:   Uuid,
    library_path: &str,
    lib_type:     &str,
) -> Result<()> {
    let path = std::path::Path::new(library_path);
    if !path.exists() {
        sqlx::query!(
            "UPDATE media.libraries SET scan_status = 'error', scan_error = $2 WHERE id = $1",
            library_id,
            "Dossier introuvable"
        )
        .execute(db)
        .await?;
        return Ok(());
    }

    sqlx::query!(
        "UPDATE media.libraries SET scan_status = 'scanning', scan_error = NULL WHERE id = $1",
        library_id
    )
    .execute(db)
    .await?;

    let job_id: Uuid = sqlx::query_scalar!(
        r#"INSERT INTO media.scan_jobs (library_id, status, started_at)
           VALUES ($1, 'running', NOW())
           RETURNING id"#,
        library_id
    )
    .fetch_one(db)
    .await?;

    let is_audio   = lib_type == "music";
    let is_shows   = lib_type == "shows";
    // movies + home_videos → is_video
    let is_video   = !is_audio && !is_shows;

    let extensions: Vec<String> = if is_audio {
        settings.scan.audio_extensions.clone()
    } else {
        settings.scan.video_extensions.clone()
    };

    // Per-scan caches to avoid duplicate artist/album DB lookups
    let mut artist_cache: HashMap<String, Uuid> = HashMap::new();
    let mut album_cache:  HashMap<(String, Option<Uuid>), Uuid> = HashMap::new();
    // Albums whose local artwork has been resolved during this scan
    let mut cover_done:   HashSet<Uuid> = HashSet::new();

    let files: Vec<_> = scanner::find_files(path, &extensions).collect();
    let total = files.len() as i32;

    sqlx::query!(
        "UPDATE media.scan_jobs SET files_found = $2 WHERE id = $1",
        job_id, total
    )
    .execute(db)
    .await?;

    let mut processed = 0i32;
    let mut added     = 0i32;

    for entry in files {
        let file_path = entry.path().to_string_lossy().to_string();
        let file_size = entry.metadata().map(|m| m.len() as i64).unwrap_or(0);

        if is_video {
            let exists: bool = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM media.movies WHERE file_path = $1)",
                file_path
            )
            .fetch_one(db)
            .await?
            .unwrap_or(false);

            if !exists {
                let (title, _year) = scanner::parse_video_filename(
                    entry.file_name().to_str().unwrap_or(""),
                );

                let info = ffprobe::probe(&settings.transcoding.ffprobe_bin, &file_path)
                    .await
                    .unwrap_or_default();

                // Local NFO metadata has priority:
                // it seeds exact provider IDs and can lock the item entirely.
                let movie_nfo = nfo::read_movie_nfo(entry.path()).await.unwrap_or_default();
                let title = movie_nfo.title.clone().unwrap_or(title);
                let release_date = movie_nfo.year
                    .and_then(|y| chrono::NaiveDate::from_ymd_opt(y, 1, 1));
                let meta_status = if movie_nfo.lockdata { "ready" } else { "pending_meta" };

                sqlx::query!(
                    r#"INSERT INTO media.movies
                       (library_id, file_path, file_size, duration_secs, video_codec,
                        audio_codec, resolution_w, resolution_h, title,
                        original_title, overview, release_date, genres,
                        content_rating, tmdb_id, imdb_id, meta_locked, meta_status)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                       ON CONFLICT (file_path) DO NOTHING"#,
                    library_id,
                    file_path,
                    file_size,
                    info.duration_secs,
                    info.video_codec,
                    info.audio_codec,
                    info.width,
                    info.height,
                    title,
                    movie_nfo.original_title,
                    movie_nfo.plot,
                    release_date,
                    &movie_nfo.genres,
                    movie_nfo.mpaa,
                    movie_nfo.tmdb_id,
                    movie_nfo.imdb_id,
                    movie_nfo.lockdata,
                    meta_status,
                )
                .execute(db)
                .await?;

                added += 1;
            }
        } else if is_shows {
            let filename = entry.file_name().to_str().unwrap_or("");
            let (season_num, episode_num, name_from_file) =
                scanner::parse_episode_filename(filename);

            // Prefer directory-based show name (more reliable than filename)
            let show_name = scanner::parse_show_name_from_path(entry.path())
                .filter(|s| !s.is_empty())
                .unwrap_or(name_from_file);

            // Check if episode already indexed
            let ep_exists: bool = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM media.tv_episodes WHERE file_path = $1)",
                file_path
            )
            .fetch_one(db)
            .await?
            .unwrap_or(false);

            if !ep_exists {
                // Local NFO (tvshow.nfo) seeds name/plot/genres/tmdb_id and can
                // lock the show against remote refresh.
                let show_nfo = nfo::read_show_nfo(entry.path()).await.unwrap_or_default();
                let show_name = show_nfo.title.clone().unwrap_or(show_name);
                let show_meta_status = if show_nfo.lockdata { "ready" } else { "pending_meta" };

                // Upsert show
                let show_id: Uuid = sqlx::query_scalar!(
                    r#"INSERT INTO media.tv_shows
                       (library_id, name, meta_status, overview, genres, tmdb_id, meta_locked)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)
                       ON CONFLICT DO NOTHING
                       RETURNING id"#,
                    library_id,
                    show_name,
                    show_meta_status,
                    show_nfo.plot,
                    &show_nfo.genres,
                    show_nfo.tmdb_id,
                    show_nfo.lockdata,
                )
                .fetch_optional(db)
                .await?
                .unwrap_or_else(|| {
                    // Inserted nothing → row already exists, fetch id
                    Uuid::nil() // placeholder, replaced below
                });

                let show_id = if show_id == Uuid::nil() {
                    sqlx::query_scalar!(
                        "SELECT id FROM media.tv_shows WHERE library_id = $1 AND name = $2",
                        library_id,
                        show_name,
                    )
                    .fetch_one(db)
                    .await?
                } else {
                    show_id
                };

                // Upsert season
                let season_id: Uuid = sqlx::query_scalar!(
                    r#"INSERT INTO media.tv_seasons (show_id, season_number)
                       VALUES ($1, $2)
                       ON CONFLICT (show_id, season_number) DO NOTHING
                       RETURNING id"#,
                    show_id,
                    season_num,
                )
                .fetch_optional(db)
                .await?
                .unwrap_or_else(Uuid::nil);

                let season_id = if season_id == Uuid::nil() {
                    sqlx::query_scalar!(
                        "SELECT id FROM media.tv_seasons WHERE show_id = $1 AND season_number = $2",
                        show_id,
                        season_num,
                    )
                    .fetch_one(db)
                    .await?
                } else {
                    season_id
                };

                let info = ffprobe::probe(&settings.transcoding.ffprobe_bin, &file_path)
                    .await
                    .unwrap_or_default();

                sqlx::query!(
                    r#"INSERT INTO media.tv_episodes
                       (season_id, show_id, file_path, file_size, episode_number,
                        duration_secs, video_codec, audio_codec, resolution_w, resolution_h)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                       ON CONFLICT (file_path) DO NOTHING"#,
                    season_id,
                    show_id,
                    file_path,
                    file_size,
                    episode_num,
                    info.duration_secs,
                    info.video_codec,
                    info.audio_codec,
                    info.width,
                    info.height,
                )
                .execute(db)
                .await?;

                // Keep season episode count in sync
                sqlx::query!(
                    r#"UPDATE media.tv_seasons
                       SET episode_count = (
                           SELECT COUNT(*) FROM media.tv_episodes
                           WHERE season_id = $1
                       ) WHERE id = $1"#,
                    season_id,
                )
                .execute(db)
                .await?;

                // Keep show counts in sync
                sqlx::query!(
                    r#"UPDATE media.tv_shows
                       SET episode_count = (
                               SELECT COUNT(*) FROM media.tv_episodes WHERE show_id = $1
                           ),
                           season_count = (
                               SELECT COUNT(*) FROM media.tv_seasons WHERE show_id = $1
                           )
                       WHERE id = $1"#,
                    show_id,
                )
                .execute(db)
                .await?;

                added += 1;
            }
        } else if is_audio {
            // Probe first: embedded tags (ID3/Vorbis/MP4) are far more
            // reliable than guessing artist/album/title from the file path.
            let info = ffprobe::probe(&settings.transcoding.ffprobe_bin, &file_path)
                .await
                .unwrap_or_default();
            let (path_artist, path_album, path_title) = scanner::parse_audio_path(entry.path());
            let tags = &info.tags;
            let artist_name = tags.album_artist.clone()
                .or_else(|| tags.artist.clone())
                .or(path_artist);
            let album_name = tags.album.clone().or(path_album);
            let title = tags.title.clone().unwrap_or(path_title);

            let artist_id: Option<Uuid> = match artist_name.as_deref() {
                Some(name) => resolve_artist(db, library_id, name, &mut artist_cache).await
                    .map(Some)
                    .unwrap_or_else(|e| { tracing::warn!(error=%e, "Erreur artiste"); None }),
                None => None,
            };

            let album_id: Option<Uuid> = match album_name.as_deref() {
                Some(t) => resolve_album(db, library_id, t, artist_id, &mut album_cache).await
                    .map(Some)
                    .unwrap_or_else(|e| { tracing::warn!(error=%e, "Erreur album"); None }),
                None => None,
            };

            // Backfill the album release year from the embedded date tag.
            if let (Some(aid), Some(year)) = (album_id, tags.year) {
                sqlx::query!(
                    "UPDATE media.albums SET release_year = COALESCE(release_year, $2) WHERE id = $1",
                    aid, year
                )
                .execute(db)
                .await?;
            }

            // Local artwork (folder image / embedded art) beats remote covers —
            // resolve once per album per scan.
            if let Some(aid) = album_id {
                if cover_done.insert(aid) {
                    let already_local: Option<bool> = sqlx::query_scalar!(
                        "SELECT cover_path LIKE '/api/%' FROM media.albums WHERE id = $1",
                        aid
                    )
                    .fetch_one(db)
                    .await?;
                    if !already_local.unwrap_or(false) {
                        if let Some(api_path) = covers::resolve_local_cover(
                            &settings.transcoding.ffmpeg_bin,
                            &covers::covers_base(settings),
                            aid,
                            entry.path(),
                        )
                        .await
                        {
                            sqlx::query!(
                                "UPDATE media.albums SET cover_path = $2 WHERE id = $1",
                                aid, api_path
                            )
                            .execute(db)
                            .await?;
                        }
                    }
                }
            }

            let exists: bool = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM media.tracks WHERE file_path = $1)",
                file_path
            )
            .fetch_one(db)
            .await?
            .unwrap_or(false);

            // Upsert: new tracks get inserted, existing tracks get their
            // linkage and tag-derived fields refreshed (tags are authoritative).
            sqlx::query!(
                r#"INSERT INTO media.tracks
                   (library_id, file_path, file_size, title, duration_secs,
                    codec, bitrate, sample_rate, channels, artist_id, album_id,
                    track_number, disc_number, composer, lyricist)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                   ON CONFLICT (file_path) DO UPDATE
                   SET artist_id    = EXCLUDED.artist_id,
                       album_id     = EXCLUDED.album_id,
                       title        = EXCLUDED.title,
                       track_number = COALESCE(EXCLUDED.track_number, media.tracks.track_number),
                       disc_number  = EXCLUDED.disc_number,
                       composer     = COALESCE(EXCLUDED.composer, media.tracks.composer),
                       lyricist     = COALESCE(EXCLUDED.lyricist, media.tracks.lyricist)"#,
                library_id, file_path, file_size, title,
                info.duration_secs, info.audio_codec, info.bitrate,
                info.sample_rate, info.channels, artist_id, album_id,
                tags.track_number, tags.disc_number.unwrap_or(1),
                tags.composer, tags.lyricist,
            )
            .execute(db)
            .await?;

            if !exists {
                added += 1;
            }
        }

        processed += 1;

        if processed % 50 == 0 {
            sqlx::query!(
                "UPDATE media.scan_jobs SET files_processed = $2 WHERE id = $1",
                job_id, processed
            )
            .execute(db)
            .await?;
        }
    }

    // Update library item count
    sqlx::query!(
        r#"UPDATE media.libraries
           SET item_count   = item_count + $2,
               last_scan_at = NOW(),
               scan_status  = 'idle'
           WHERE id = $1"#,
        library_id,
        added,
    )
    .execute(db)
    .await?;

    sqlx::query!(
        r#"UPDATE media.scan_jobs
           SET status = 'done', files_processed = $2, files_added = $3, finished_at = NOW()
           WHERE id = $1"#,
        job_id,
        processed,
        added,
    )
    .execute(db)
    .await?;

    tracing::info!(library_id = %library_id, processed, added, "Scan terminé");

    // Refresh artist/album counts for audio libraries (even when 0 new tracks,
    // in case a re-scan backfilled artist_id/album_id on existing tracks).
    if is_audio {
        if let Err(e) = refresh_audio_counts(db, library_id).await {
            tracing::error!(error = %e, "Erreur refresh counts audio");
        }
    }

    // Trigger metadata enrichment for newly scanned items
    if added > 0 {
        let db2 = db.clone();
        let s2  = settings.clone();
        let is_shows_copy = is_shows;
        let is_video_copy = is_video;
        let is_audio_copy = is_audio;
        tokio::spawn(async move {
            if is_video_copy {
                if let Err(e) = super::metadata::enrich_pending(&db2, &s2).await {
                    tracing::error!(error = %e, "Erreur enrichissement movies post-scan");
                }
            }
            if is_shows_copy {
                if let Err(e) = super::metadata::enrich_pending_shows(&db2, &s2).await {
                    tracing::error!(error = %e, "Erreur enrichissement shows post-scan");
                }
            }
            if is_audio_copy {
                if let Err(e) = super::metadata::enrich_pending_artists(&db2, &s2).await {
                    tracing::error!(error = %e, "Erreur enrichissement artistes post-scan");
                }
                if let Err(e) = super::metadata::enrich_pending_albums(&db2, &s2).await {
                    tracing::error!(error = %e, "Erreur enrichissement albums post-scan");
                }
            }
        });
    }

    Ok(())
}

/// Index a single file detected by the filesystem watcher.
pub async fn index_single_file(
    db:         &PgPool,
    settings:   &Arc<Settings>,
    library_id: Uuid,
    file_path:  &str,
    lib_type:   &str,
) -> Result<()> {
    let metadata = tokio::fs::metadata(file_path).await?;
    let file_size = metadata.len() as i64;

    if lib_type == "shows" {
        let path = std::path::Path::new(file_path);
        let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or(file_path);
        let (season_num, episode_num, name_from_file) = scanner::parse_episode_filename(filename);
        let show_name = scanner::parse_show_name_from_path(path)
            .filter(|s| !s.is_empty())
            .unwrap_or(name_from_file);

        let ep_exists: bool = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM media.tv_episodes WHERE file_path = $1)",
            file_path
        )
        .fetch_one(db)
        .await?
        .unwrap_or(false);

        if ep_exists {
            return Ok(());
        }

        // Local NFO (tvshow.nfo) seeds show metadata.
        let show_nfo = nfo::read_show_nfo(path).await.unwrap_or_default();
        let show_name = show_nfo.title.clone().unwrap_or(show_name);
        let show_meta_status = if show_nfo.lockdata { "ready" } else { "pending_meta" };

        let show_id: Uuid = sqlx::query_scalar!(
            r#"INSERT INTO media.tv_shows
               (library_id, name, meta_status, overview, genres, tmdb_id, meta_locked)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT DO NOTHING
               RETURNING id"#,
            library_id,
            show_name,
            show_meta_status,
            show_nfo.plot,
            &show_nfo.genres,
            show_nfo.tmdb_id,
            show_nfo.lockdata,
        )
        .fetch_optional(db)
        .await?
        .unwrap_or(Uuid::nil());

        let show_id = if show_id == Uuid::nil() {
            sqlx::query_scalar!(
                "SELECT id FROM media.tv_shows WHERE library_id = $1 AND name = $2",
                library_id,
                show_name,
            )
            .fetch_one(db)
            .await?
        } else {
            show_id
        };

        let season_id: Uuid = sqlx::query_scalar!(
            r#"INSERT INTO media.tv_seasons (show_id, season_number)
               VALUES ($1, $2)
               ON CONFLICT (show_id, season_number) DO NOTHING
               RETURNING id"#,
            show_id,
            season_num,
        )
        .fetch_optional(db)
        .await?
        .unwrap_or(Uuid::nil());

        let season_id = if season_id == Uuid::nil() {
            sqlx::query_scalar!(
                "SELECT id FROM media.tv_seasons WHERE show_id = $1 AND season_number = $2",
                show_id,
                season_num,
            )
            .fetch_one(db)
            .await?
        } else {
            season_id
        };

        let info = ffprobe::probe(&settings.transcoding.ffprobe_bin, file_path)
            .await
            .unwrap_or_default();

        sqlx::query!(
            r#"INSERT INTO media.tv_episodes
               (season_id, show_id, file_path, file_size, episode_number,
                duration_secs, video_codec, audio_codec, resolution_w, resolution_h)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               ON CONFLICT (file_path) DO NOTHING"#,
            season_id, show_id, file_path, file_size, episode_num,
            info.duration_secs, info.video_codec, info.audio_codec,
            info.width, info.height,
        )
        .execute(db)
        .await?;

        sqlx::query!(
            "UPDATE media.libraries SET item_count = item_count + 1 WHERE id = $1",
            library_id
        )
        .execute(db)
        .await?;

        let db2 = db.clone();
        let s2  = settings.clone();
        tokio::spawn(async move {
            if let Err(e) = super::metadata::enrich_pending_shows(&db2, &s2).await {
                tracing::error!(error = %e, "Erreur enrichissement shows post-watcher");
            }
        });
    } else if lib_type != "music" {
        // Video (movies + home_videos)
        let exists: bool = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM media.movies WHERE file_path = $1)",
            file_path
        )
        .fetch_one(db)
        .await?
        .unwrap_or(false);

        if exists {
            return Ok(());
        }

        let path = std::path::Path::new(file_path);
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(file_path);
        let (title, _year) = scanner::parse_video_filename(filename);

        let info = ffprobe::probe(&settings.transcoding.ffprobe_bin, file_path)
            .await
            .unwrap_or_default();

        // Local NFO metadata has priority.
        let movie_nfo = nfo::read_movie_nfo(path).await.unwrap_or_default();
        let title = movie_nfo.title.clone().unwrap_or(title);
        let release_date = movie_nfo.year
            .and_then(|y| chrono::NaiveDate::from_ymd_opt(y, 1, 1));
        let meta_status = if movie_nfo.lockdata { "ready" } else { "pending_meta" };

        sqlx::query!(
            r#"INSERT INTO media.movies
               (library_id, file_path, file_size, duration_secs, video_codec,
                audio_codec, resolution_w, resolution_h, title,
                original_title, overview, release_date, genres,
                content_rating, tmdb_id, imdb_id, meta_locked, meta_status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
               ON CONFLICT (file_path) DO NOTHING"#,
            library_id, file_path, file_size,
            info.duration_secs, info.video_codec, info.audio_codec,
            info.width, info.height, title,
            movie_nfo.original_title,
            movie_nfo.plot,
            release_date,
            &movie_nfo.genres,
            movie_nfo.mpaa,
            movie_nfo.tmdb_id,
            movie_nfo.imdb_id,
            movie_nfo.lockdata,
            meta_status,
        )
        .execute(db)
        .await?;

        sqlx::query!(
            "UPDATE media.libraries SET item_count = item_count + 1 WHERE id = $1",
            library_id
        )
        .execute(db)
        .await?;

        let db2 = db.clone();
        let s2  = settings.clone();
        tokio::spawn(async move {
            if let Err(e) = super::metadata::enrich_pending(&db2, &s2).await {
                tracing::error!(error = %e, "Erreur enrichissement post-watcher");
            }
        });
    } else {
        // Audio — probe first: embedded tags beat path guessing.
        let info = ffprobe::probe(&settings.transcoding.ffprobe_bin, file_path)
            .await
            .unwrap_or_default();
        let (path_artist, path_album, path_title) =
            scanner::parse_audio_path(std::path::Path::new(file_path));
        let tags = &info.tags;
        let artist_name = tags.album_artist.clone()
            .or_else(|| tags.artist.clone())
            .or(path_artist);
        let album_name = tags.album.clone().or(path_album);
        let title = tags.title.clone().unwrap_or(path_title);

        let mut artist_cache: HashMap<String, Uuid> = HashMap::new();
        let mut album_cache:  HashMap<(String, Option<Uuid>), Uuid> = HashMap::new();

        let artist_id: Option<Uuid> = match artist_name.as_deref() {
            Some(n) => resolve_artist(db, library_id, n, &mut artist_cache).await.ok(),
            None    => None,
        };
        let album_id: Option<Uuid> = match album_name.as_deref() {
            Some(t) => resolve_album(db, library_id, t, artist_id, &mut album_cache).await.ok(),
            None    => None,
        };

        if let (Some(aid), Some(year)) = (album_id, tags.year) {
            sqlx::query!(
                "UPDATE media.albums SET release_year = COALESCE(release_year, $2) WHERE id = $1",
                aid, year
            )
            .execute(db)
            .await?;
        }

        // Local artwork beats remote covers.
        if let Some(aid) = album_id {
            let already_local: Option<bool> = sqlx::query_scalar!(
                "SELECT cover_path LIKE '/api/%' FROM media.albums WHERE id = $1",
                aid
            )
            .fetch_one(db)
            .await?;
            if !already_local.unwrap_or(false) {
                if let Some(api_path) = covers::resolve_local_cover(
                    &settings.transcoding.ffmpeg_bin,
                    &covers::covers_base(settings),
                    aid,
                    std::path::Path::new(file_path),
                )
                .await
                {
                    sqlx::query!(
                        "UPDATE media.albums SET cover_path = $2 WHERE id = $1",
                        aid, api_path
                    )
                    .execute(db)
                    .await?;
                }
            }
        }

        let exists: bool = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM media.tracks WHERE file_path = $1)",
            file_path
        )
        .fetch_one(db)
        .await?
        .unwrap_or(false);

        sqlx::query!(
            r#"INSERT INTO media.tracks
               (library_id, file_path, file_size, title, duration_secs,
                codec, bitrate, sample_rate, channels, artist_id, album_id,
                track_number, disc_number, composer, lyricist)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
               ON CONFLICT (file_path) DO UPDATE
               SET artist_id    = EXCLUDED.artist_id,
                   album_id     = EXCLUDED.album_id,
                   title        = EXCLUDED.title,
                   track_number = COALESCE(EXCLUDED.track_number, media.tracks.track_number),
                   disc_number  = EXCLUDED.disc_number,
                   composer     = COALESCE(EXCLUDED.composer, media.tracks.composer),
                   lyricist     = COALESCE(EXCLUDED.lyricist, media.tracks.lyricist)"#,
            library_id, file_path, file_size, title,
            info.duration_secs, info.audio_codec, info.bitrate,
            info.sample_rate, info.channels, artist_id, album_id,
            tags.track_number, tags.disc_number.unwrap_or(1),
            tags.composer, tags.lyricist,
        )
        .execute(db)
        .await?;

        if !exists {
            sqlx::query!(
                "UPDATE media.libraries SET item_count = item_count + 1 WHERE id = $1",
                library_id
            )
            .execute(db)
            .await?;
        }

        if let Err(e) = refresh_audio_counts(db, library_id).await {
            tracing::error!(error = %e, "Erreur refresh counts audio watcher");
        }
    }

    tracing::info!(path = %file_path, "Fichier indexé");
    Ok(())
}
