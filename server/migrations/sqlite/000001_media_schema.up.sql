-- SQLite — `media` is an ATTACHed database file, attached on every pooled
-- connection by kubuno-db, so the qualified names below resolve as they do on
-- the other two engines. This single file declares the FINAL shape the
-- PostgreSQL side reached across its 000001..000017 migrations.
--
-- Differences from PostgreSQL, and why:
--   * UUID -> BLOB, TIMESTAMPTZ -> TEXT (`%F %T%.f`, UTC), DATE -> TEXT, as sqlx
--     encodes them. No DEFAULT on `id`: the process supplies every key.
--   * TEXT[]/UUID[] -> TEXT holding a JSON array; JSONB -> TEXT holding JSON;
--     DECIMAL read as f64 -> REAL; BOOLEAN -> INTEGER (0/1).
--   * updated_at is maintained by AFTER UPDATE triggers (recursive triggers are
--     off by default, so the self-update does not loop).
--   * Foreign-key REFERENCES are unqualified (SQLite assumes the same database);
--     kubuno-db enables `PRAGMA foreign_keys`, so CASCADE deletes fire.
--   * Functional/partial unique indexes on lower(name)/lower(title) are dropped;
--     the scanner resolves case-insensitive matches with a SELECT before insert.

CREATE TABLE media.libraries (
    id           BLOB    NOT NULL PRIMARY KEY,
    owner_id     BLOB,
    name         TEXT    NOT NULL,
    lib_type     TEXT    NOT NULL,
    path         TEXT    NOT NULL,
    icon         TEXT    NOT NULL DEFAULT '🎬',
    color        TEXT    NOT NULL DEFAULT '#1a73e8',
    is_shared    INTEGER NOT NULL DEFAULT 1,
    item_count   INTEGER NOT NULL DEFAULT 0,
    last_scan_at TEXT,
    scan_status  TEXT    NOT NULL DEFAULT 'idle',
    scan_error   TEXT,
    source_type     TEXT NOT NULL DEFAULT 'filesystem',
    files_folder_id BLOB,
    files_owner_id  BLOB,
    shared_user_ids TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_media_libs_type ON libraries(lib_type);
CREATE TRIGGER media.libraries_updated_at AFTER UPDATE ON libraries FOR EACH ROW
BEGIN UPDATE libraries SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END;

CREATE TABLE media.scan_jobs (
    id              BLOB    NOT NULL PRIMARY KEY,
    library_id      BLOB    NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    status          TEXT    NOT NULL DEFAULT 'pending',
    files_found     INTEGER NOT NULL DEFAULT 0,
    files_processed INTEGER NOT NULL DEFAULT 0,
    files_added     INTEGER NOT NULL DEFAULT 0,
    files_updated   INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT,
    started_at      TEXT,
    finished_at     TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_media_scanjobs_lib ON scan_jobs(library_id, created_at);

CREATE TABLE media.movies (
    id               BLOB    NOT NULL PRIMARY KEY,
    library_id       BLOB    NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    file_path        TEXT    NOT NULL UNIQUE,
    file_size        INTEGER NOT NULL DEFAULT 0,
    duration_secs    INTEGER NOT NULL DEFAULT 0,
    video_codec      TEXT,
    audio_codec      TEXT,
    resolution_w     INTEGER,
    resolution_h     INTEGER,
    tmdb_id          INTEGER,
    imdb_id          TEXT,
    title            TEXT    NOT NULL,
    original_title   TEXT,
    overview         TEXT,
    tagline          TEXT,
    release_date     TEXT,
    runtime_mins     INTEGER,
    poster_path      TEXT,
    backdrop_path    TEXT,
    vote_average     REAL,
    vote_count       INTEGER,
    popularity       REAL,
    genres               TEXT NOT NULL DEFAULT '[]',
    original_language    TEXT,
    production_countries TEXT NOT NULL DEFAULT '[]',
    meta_status      TEXT    NOT NULL DEFAULT 'pending_meta',
    cast_json        TEXT    NOT NULL DEFAULT '[]',
    crew_json        TEXT    NOT NULL DEFAULT '[]',
    subtitles        TEXT    NOT NULL DEFAULT '[]',
    transcode_status TEXT    NOT NULL DEFAULT '{}',
    content_rating   TEXT,
    trailer_key      TEXT,
    poster_urls      TEXT    NOT NULL DEFAULT '[]',
    wikidata_id      TEXT,
    meta_retries     INTEGER NOT NULL DEFAULT 0,
    meta_locked      INTEGER NOT NULL DEFAULT 0,
    ratings_json     TEXT    NOT NULL DEFAULT '{}',
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_media_movies_lib          ON movies(library_id);
CREATE INDEX media.idx_media_movies_tmdb         ON movies(tmdb_id);
CREATE INDEX media.idx_media_movies_release      ON movies(release_date);
CREATE INDEX media.idx_media_movies_popularity   ON movies(popularity);
CREATE INDEX media.idx_media_movies_meta_pending ON movies(meta_status);
CREATE TRIGGER media.movies_updated_at AFTER UPDATE ON movies FOR EACH ROW
BEGIN UPDATE movies SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END;

CREATE TABLE media.tv_shows (
    id                BLOB    NOT NULL PRIMARY KEY,
    library_id        BLOB    NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    tmdb_id           INTEGER UNIQUE,
    tvdb_id           INTEGER,
    name              TEXT    NOT NULL,
    original_name     TEXT,
    overview          TEXT,
    tagline           TEXT,
    first_air_date    TEXT,
    last_air_date     TEXT,
    status            TEXT,
    poster_path       TEXT,
    backdrop_path     TEXT,
    vote_average      REAL,
    vote_count        INTEGER,
    genres            TEXT    NOT NULL DEFAULT '[]',
    networks          TEXT    NOT NULL DEFAULT '[]',
    season_count      INTEGER NOT NULL DEFAULT 0,
    episode_count     INTEGER NOT NULL DEFAULT 0,
    original_language TEXT,
    cast_json         TEXT    NOT NULL DEFAULT '[]',
    crew_json         TEXT    NOT NULL DEFAULT '[]',
    meta_status       TEXT    NOT NULL DEFAULT 'pending_meta',
    tvmaze_id         INTEGER,
    wikidata_id       TEXT,
    meta_retries      INTEGER NOT NULL DEFAULT 0,
    meta_locked       INTEGER NOT NULL DEFAULT 0,
    ratings_json      TEXT    NOT NULL DEFAULT '{}',
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_media_shows_lib          ON tv_shows(library_id);
CREATE INDEX media.idx_media_shows_tmdb         ON tv_shows(tmdb_id);
CREATE INDEX media.idx_media_shows_tvmaze       ON tv_shows(tvmaze_id);
CREATE INDEX media.idx_media_shows_meta_pending ON tv_shows(meta_status);
CREATE TRIGGER media.tv_shows_updated_at AFTER UPDATE ON tv_shows FOR EACH ROW
BEGIN UPDATE tv_shows SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END;

CREATE TABLE media.tv_seasons (
    id            BLOB    NOT NULL PRIMARY KEY,
    show_id       BLOB    NOT NULL REFERENCES tv_shows(id) ON DELETE CASCADE,
    tmdb_id       INTEGER,
    season_number INTEGER NOT NULL,
    name          TEXT,
    overview      TEXT,
    air_date      TEXT,
    poster_path   TEXT,
    episode_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (show_id, season_number)
);
CREATE INDEX media.idx_media_seasons_show ON tv_seasons(show_id, season_number);

CREATE TABLE media.tv_episodes (
    id             BLOB    NOT NULL PRIMARY KEY,
    season_id      BLOB    NOT NULL REFERENCES tv_seasons(id) ON DELETE CASCADE,
    show_id        BLOB    NOT NULL REFERENCES tv_shows(id) ON DELETE CASCADE,
    file_path      TEXT    UNIQUE,
    file_size      INTEGER,
    tmdb_id        INTEGER,
    episode_number INTEGER NOT NULL,
    name           TEXT,
    overview       TEXT,
    air_date       TEXT,
    still_path     TEXT,
    vote_average   REAL,
    duration_secs  INTEGER,
    video_codec    TEXT,
    audio_codec    TEXT,
    resolution_w   INTEGER,
    resolution_h   INTEGER,
    subtitles        TEXT  NOT NULL DEFAULT '[]',
    transcode_status TEXT  NOT NULL DEFAULT '{}',
    meta_status    TEXT    NOT NULL DEFAULT 'pending_meta',
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (season_id, episode_number)
);
CREATE INDEX media.idx_media_episodes_season ON tv_episodes(season_id, episode_number);
CREATE INDEX media.idx_media_episodes_show   ON tv_episodes(show_id);
CREATE TRIGGER media.tv_episodes_updated_at AFTER UPDATE ON tv_episodes FOR EACH ROW
BEGIN UPDATE tv_episodes SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END;

CREATE TABLE media.artists (
    id          BLOB    NOT NULL PRIMARY KEY,
    library_id  BLOB    REFERENCES libraries(id) ON DELETE SET NULL,
    mbid        TEXT    UNIQUE,
    name        TEXT    NOT NULL,
    sort_name   TEXT,
    biography   TEXT,
    image_path  TEXT,
    genres      TEXT    NOT NULL DEFAULT '[]',
    country     TEXT,
    begin_date  TEXT,
    end_date    TEXT,
    artist_type TEXT,
    album_count INTEGER NOT NULL DEFAULT 0,
    track_count INTEGER NOT NULL DEFAULT 0,
    meta_status TEXT    NOT NULL DEFAULT 'pending_meta',
    meta_retries INTEGER NOT NULL DEFAULT 0,
    meta_locked INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_media_artists_lib     ON artists(library_id);
CREATE INDEX media.idx_media_artists_name    ON artists(sort_name);
CREATE INDEX media.idx_media_artists_libname ON artists(library_id, name COLLATE NOCASE);
CREATE TRIGGER media.artists_updated_at AFTER UPDATE ON artists FOR EACH ROW
BEGIN UPDATE artists SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END;

CREATE TABLE media.albums (
    id           BLOB    NOT NULL PRIMARY KEY,
    library_id   BLOB    REFERENCES libraries(id) ON DELETE SET NULL,
    artist_id    BLOB    REFERENCES artists(id) ON DELETE SET NULL,
    mbid         TEXT    UNIQUE,
    title        TEXT    NOT NULL,
    sort_title   TEXT,
    release_date TEXT,
    release_year INTEGER,
    album_type   TEXT    NOT NULL DEFAULT 'Album',
    cover_path   TEXT,
    genres       TEXT    NOT NULL DEFAULT '[]',
    label        TEXT,
    track_count  INTEGER NOT NULL DEFAULT 0,
    duration_secs INTEGER NOT NULL DEFAULT 0,
    meta_status  TEXT    NOT NULL DEFAULT 'pending_meta',
    meta_retries INTEGER NOT NULL DEFAULT 0,
    meta_locked  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_media_albums_lib       ON albums(library_id);
CREATE INDEX media.idx_media_albums_artist    ON albums(artist_id);
CREATE INDEX media.idx_media_albums_release   ON albums(release_year);
CREATE INDEX media.idx_media_albums_libartist ON albums(library_id, artist_id);
CREATE TRIGGER media.albums_updated_at AFTER UPDATE ON albums FOR EACH ROW
BEGIN UPDATE albums SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END;

CREATE TABLE media.tracks (
    id                 BLOB    NOT NULL PRIMARY KEY,
    album_id           BLOB    REFERENCES albums(id) ON DELETE SET NULL,
    artist_id          BLOB    REFERENCES artists(id) ON DELETE SET NULL,
    library_id         BLOB    REFERENCES libraries(id) ON DELETE SET NULL,
    mbid               TEXT,
    file_path          TEXT    NOT NULL UNIQUE,
    file_size          INTEGER NOT NULL DEFAULT 0,
    title              TEXT    NOT NULL,
    track_number       INTEGER,
    disc_number        INTEGER NOT NULL DEFAULT 1,
    duration_secs      INTEGER NOT NULL DEFAULT 0,
    codec              TEXT,
    bitrate            INTEGER,
    sample_rate        INTEGER,
    bit_depth          INTEGER,
    channels           INTEGER NOT NULL DEFAULT 2,
    composer           TEXT,
    lyricist           TEXT,
    bpm                INTEGER,
    lyrics             TEXT,
    replay_gain_track  REAL,
    replay_gain_album  REAL,
    meta_status        TEXT    NOT NULL DEFAULT 'ready',
    play_count         INTEGER NOT NULL DEFAULT 0,
    lyrics_source      TEXT,
    lyrics_synced      INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_media_tracks_album  ON tracks(album_id, disc_number, track_number);
CREATE INDEX media.idx_media_tracks_artist ON tracks(artist_id);
CREATE INDEX media.idx_media_tracks_lib    ON tracks(library_id);
CREATE INDEX media.idx_media_tracks_title  ON tracks(title);
CREATE TRIGGER media.tracks_updated_at AFTER UPDATE ON tracks FOR EACH ROW
BEGIN UPDATE tracks SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END;

CREATE TABLE media.playlists (
    id            BLOB    NOT NULL PRIMARY KEY,
    owner_id      BLOB    NOT NULL,
    name          TEXT    NOT NULL,
    description   TEXT,
    cover_path    TEXT,
    playlist_type TEXT    NOT NULL DEFAULT 'personal',
    smart_rules   TEXT,
    is_public     INTEGER NOT NULL DEFAULT 0,
    track_count   INTEGER NOT NULL DEFAULT 0,
    duration_secs INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_media_playlists_owner ON playlists(owner_id);
CREATE TRIGGER media.playlists_updated_at AFTER UPDATE ON playlists FOR EACH ROW
BEGIN UPDATE playlists SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END;

CREATE TABLE media.playlist_tracks (
    playlist_id BLOB    NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    BLOB    NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    added_by    BLOB    NOT NULL,
    added_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX media.idx_media_plt_playlist ON playlist_tracks(playlist_id, position);

CREATE TABLE media.liked_tracks (
    user_id  BLOB    NOT NULL,
    track_id BLOB    NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    liked_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (user_id, track_id)
);
CREATE INDEX media.idx_media_liked_user ON liked_tracks(user_id, liked_at);

CREATE TABLE media.video_progress (
    user_id        BLOB    NOT NULL,
    item_type      TEXT    NOT NULL,
    item_id        BLOB    NOT NULL,
    position_secs  INTEGER NOT NULL DEFAULT 0,
    duration_secs  INTEGER NOT NULL DEFAULT 0,
    percent_played REAL    NOT NULL DEFAULT 0,
    is_watched     INTEGER NOT NULL DEFAULT 0,
    last_played_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (user_id, item_type, item_id)
);
CREATE INDEX media.idx_media_vprog_user ON video_progress(user_id, last_played_at);

CREATE TABLE media.listen_history (
    id            BLOB    NOT NULL PRIMARY KEY,
    user_id       BLOB    NOT NULL,
    track_id      BLOB    NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    listened_secs INTEGER NOT NULL DEFAULT 0,
    is_complete   INTEGER NOT NULL DEFAULT 0,
    played_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_media_lhist_user  ON listen_history(user_id, played_at);
CREATE INDEX media.idx_media_lhist_track ON listen_history(track_id);

CREATE TABLE media.settings (
    setting_key TEXT NOT NULL PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
INSERT INTO media.settings (setting_key, value) VALUES ('tmdb_api_key', ''), ('tmdb_language', 'fr-FR');

CREATE TABLE media.watchlist (
    user_id   BLOB    NOT NULL,
    item_type TEXT    NOT NULL,
    item_id   BLOB    NOT NULL,
    added_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (user_id, item_type, item_id)
);
CREATE INDEX media.idx_media_watchlist_user ON watchlist(user_id, item_type);

CREATE TABLE media.radio_stations (
    id          BLOB    NOT NULL PRIMARY KEY,
    name        TEXT    NOT NULL,
    stream_url  TEXT    NOT NULL,
    homepage    TEXT,
    favicon     TEXT,
    tags        TEXT    NOT NULL DEFAULT '[]',
    country     TEXT,
    language    TEXT,
    codec       TEXT,
    bitrate     INTEGER,
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    owner_id    BLOB,
    slug        TEXT    UNIQUE,
    click_count INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_radio_stations_owner ON radio_stations(owner_id);
CREATE TRIGGER media.radio_stations_updated_at AFTER UPDATE ON radio_stations FOR EACH ROW
BEGIN UPDATE radio_stations SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END;

CREATE TABLE media.radio_favorites (
    user_id    BLOB    NOT NULL,
    station_id BLOB    NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (user_id, station_id)
);

CREATE TABLE media.radio_recent (
    user_id    BLOB    NOT NULL,
    station_id BLOB    NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
    played_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (user_id, station_id)
);
CREATE INDEX media.idx_radio_recent_user ON radio_recent(user_id, played_at);

CREATE TABLE media.tv_channels (
    id          BLOB    NOT NULL PRIMARY KEY,
    name        TEXT    NOT NULL,
    stream_url  TEXT    NOT NULL,
    homepage    TEXT,
    logo        TEXT,
    categories  TEXT    NOT NULL DEFAULT '[]',
    country     TEXT,
    language    TEXT,
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    owner_id    BLOB,
    slug        TEXT    UNIQUE,
    click_count INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX media.idx_tv_channels_owner ON tv_channels(owner_id);
CREATE TRIGGER media.tv_channels_updated_at AFTER UPDATE ON tv_channels FOR EACH ROW
BEGIN UPDATE tv_channels SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END;

CREATE TABLE media.tv_favorites (
    user_id    BLOB    NOT NULL,
    channel_id BLOB    NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE media.tv_recent (
    user_id    BLOB    NOT NULL,
    channel_id BLOB    NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
    played_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX media.idx_tv_recent_user ON tv_recent(user_id, played_at);
