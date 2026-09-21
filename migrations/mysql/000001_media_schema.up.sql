-- MySQL / MariaDB — the `media` database is created by kubuno-db's schema setup
-- before the migrator runs, so there is no CREATE DATABASE here. This single
-- file declares the FINAL shape the PostgreSQL side reached across its
-- 000001..000017 migrations.
--
-- Differences from PostgreSQL, and why:
--   * UUID -> BINARY(16): what sqlx encodes a `uuid::Uuid` as on MySQL.
--   * No DEFAULT on `id`: MySQL has no gen_random_uuid() and no RETURNING, so
--     the process supplies every primary key.
--   * TIMESTAMPTZ -> DATETIME(6); every value written is UTC (the pool pins
--     `time_zone = '+00:00'`). updated_at uses ON UPDATE CURRENT_TIMESTAMP(6),
--     replacing the PostgreSQL set_updated_at() triggers.
--   * TEXT[]/UUID[] -> JSON arrays; DECIMAL columns read as f64 -> DOUBLE.
--   * Unique/indexed text -> VARCHAR (MySQL cannot index TEXT without a prefix);
--     file_path caps at 768 chars.
--   * Functional/partial unique indexes on lower(name)/lower(title) are dropped;
--     the scanner resolves case-insensitive matches with a SELECT before insert.

CREATE TABLE libraries (
    id           BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id     BINARY(16),
    name         VARCHAR(255) NOT NULL,
    lib_type     VARCHAR(20)  NOT NULL,
    path         TEXT         NOT NULL,
    icon         VARCHAR(50)  NOT NULL DEFAULT '🎬',
    color        VARCHAR(7)   NOT NULL DEFAULT '#1a73e8',
    is_shared    BOOLEAN      NOT NULL DEFAULT TRUE,
    item_count   INT          NOT NULL DEFAULT 0,
    last_scan_at DATETIME(6),
    scan_status  VARCHAR(10)  NOT NULL DEFAULT 'idle',
    scan_error   TEXT,
    source_type     VARCHAR(20) NOT NULL DEFAULT 'filesystem',
    files_folder_id BINARY(16),
    files_owner_id  BINARY(16),
    shared_user_ids JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                              ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_libs_type ON libraries(lib_type);

CREATE TABLE scan_jobs (
    id              BINARY(16)  NOT NULL PRIMARY KEY,
    library_id      BINARY(16)  NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    status          VARCHAR(10) NOT NULL DEFAULT 'pending',
    files_found     INT         NOT NULL DEFAULT 0,
    files_processed INT         NOT NULL DEFAULT 0,
    files_added     INT         NOT NULL DEFAULT 0,
    files_updated   INT         NOT NULL DEFAULT 0,
    error_message   TEXT,
    started_at      DATETIME(6),
    finished_at     DATETIME(6),
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_scanjobs_lib ON scan_jobs(library_id, created_at);

CREATE TABLE movies (
    id               BINARY(16)   NOT NULL PRIMARY KEY,
    library_id       BINARY(16)   NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    file_path        VARCHAR(768) NOT NULL UNIQUE,
    file_size        BIGINT       NOT NULL DEFAULT 0,
    duration_secs    INT          NOT NULL DEFAULT 0,
    video_codec      VARCHAR(50),
    audio_codec      VARCHAR(50),
    resolution_w     INT,
    resolution_h     INT,
    tmdb_id          INT,
    imdb_id          VARCHAR(20),
    title            VARCHAR(500) NOT NULL,
    original_title   VARCHAR(500),
    overview         TEXT,
    tagline          VARCHAR(500),
    release_date     DATE,
    runtime_mins     INT,
    poster_path      TEXT,
    backdrop_path    TEXT,
    vote_average     DOUBLE,
    vote_count       INT,
    popularity       DOUBLE,
    genres               JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    original_language    VARCHAR(10),
    production_countries JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    meta_status      VARCHAR(15) NOT NULL DEFAULT 'pending_meta',
    cast_json        JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    crew_json        JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    subtitles        JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    transcode_status JSON        NOT NULL DEFAULT (JSON_OBJECT()),
    content_rating   VARCHAR(20),
    trailer_key      VARCHAR(100),
    poster_urls      JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    wikidata_id      VARCHAR(20),
    meta_retries     INT         NOT NULL DEFAULT 0,
    meta_locked      BOOLEAN     NOT NULL DEFAULT FALSE,
    ratings_json     JSON        NOT NULL DEFAULT (JSON_OBJECT()),
    created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                 ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_movies_lib          ON movies(library_id);
CREATE INDEX idx_media_movies_tmdb         ON movies(tmdb_id);
CREATE INDEX idx_media_movies_release      ON movies(release_date);
CREATE INDEX idx_media_movies_popularity   ON movies(popularity);
CREATE INDEX idx_media_movies_meta_pending ON movies(meta_status);

CREATE TABLE tv_shows (
    id                BINARY(16)   NOT NULL PRIMARY KEY,
    library_id        BINARY(16)   NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    tmdb_id           INT UNIQUE,
    tvdb_id           INT,
    name              VARCHAR(500) NOT NULL,
    original_name     VARCHAR(500),
    overview          TEXT,
    tagline           VARCHAR(500),
    first_air_date    DATE,
    last_air_date     DATE,
    status            VARCHAR(50),
    poster_path       TEXT,
    backdrop_path     TEXT,
    vote_average      DOUBLE,
    vote_count        INT,
    genres            JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    networks          JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    season_count      INT         NOT NULL DEFAULT 0,
    episode_count     INT         NOT NULL DEFAULT 0,
    original_language VARCHAR(10),
    cast_json         JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    crew_json         JSON        NOT NULL DEFAULT (JSON_ARRAY()),
    meta_status       VARCHAR(15) NOT NULL DEFAULT 'pending_meta',
    tvmaze_id         INT,
    wikidata_id       VARCHAR(20),
    meta_retries      INT         NOT NULL DEFAULT 0,
    meta_locked       BOOLEAN     NOT NULL DEFAULT FALSE,
    ratings_json      JSON        NOT NULL DEFAULT (JSON_OBJECT()),
    created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                  ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_shows_lib          ON tv_shows(library_id);
CREATE INDEX idx_media_shows_tmdb         ON tv_shows(tmdb_id);
CREATE INDEX idx_media_shows_tvmaze       ON tv_shows(tvmaze_id);
CREATE INDEX idx_media_shows_meta_pending ON tv_shows(meta_status);

CREATE TABLE tv_seasons (
    id            BINARY(16)  NOT NULL PRIMARY KEY,
    show_id       BINARY(16)  NOT NULL REFERENCES tv_shows(id) ON DELETE CASCADE,
    tmdb_id       INT,
    season_number INT         NOT NULL,
    name          VARCHAR(500),
    overview      TEXT,
    air_date      DATE,
    poster_path   TEXT,
    episode_count INT         NOT NULL DEFAULT 0,
    UNIQUE (show_id, season_number)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_seasons_show ON tv_seasons(show_id, season_number);

CREATE TABLE tv_episodes (
    id             BINARY(16)   NOT NULL PRIMARY KEY,
    season_id      BINARY(16)   NOT NULL REFERENCES tv_seasons(id) ON DELETE CASCADE,
    show_id        BINARY(16)   NOT NULL REFERENCES tv_shows(id) ON DELETE CASCADE,
    file_path      VARCHAR(768) UNIQUE,
    file_size      BIGINT,
    tmdb_id        INT,
    episode_number INT          NOT NULL,
    name           VARCHAR(500),
    overview       TEXT,
    air_date       DATE,
    still_path     TEXT,
    vote_average   DOUBLE,
    duration_secs  INT,
    video_codec    VARCHAR(50),
    audio_codec    VARCHAR(50),
    resolution_w   INT,
    resolution_h   INT,
    subtitles        JSON      NOT NULL DEFAULT (JSON_ARRAY()),
    transcode_status JSON      NOT NULL DEFAULT (JSON_OBJECT()),
    meta_status    VARCHAR(15)  NOT NULL DEFAULT 'pending_meta',
    created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE (season_id, episode_number)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_episodes_season ON tv_episodes(season_id, episode_number);
CREATE INDEX idx_media_episodes_show   ON tv_episodes(show_id);

CREATE TABLE artists (
    id          BINARY(16)   NOT NULL PRIMARY KEY,
    library_id  BINARY(16)   REFERENCES libraries(id) ON DELETE SET NULL,
    mbid        VARCHAR(36) UNIQUE,
    name        VARCHAR(500) NOT NULL,
    sort_name   VARCHAR(500),
    biography   TEXT,
    image_path  TEXT,
    genres      JSON         NOT NULL DEFAULT (JSON_ARRAY()),
    country     VARCHAR(100),
    begin_date  DATE,
    end_date    DATE,
    artist_type VARCHAR(20),
    album_count INT          NOT NULL DEFAULT 0,
    track_count INT          NOT NULL DEFAULT 0,
    meta_status VARCHAR(15)  NOT NULL DEFAULT 'pending_meta',
    meta_retries INT         NOT NULL DEFAULT 0,
    meta_locked BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                             ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_artists_lib  ON artists(library_id);
CREATE INDEX idx_media_artists_name ON artists(sort_name);
CREATE INDEX idx_media_artists_libname ON artists(library_id, name);

CREATE TABLE albums (
    id           BINARY(16)   NOT NULL PRIMARY KEY,
    library_id   BINARY(16)   REFERENCES libraries(id) ON DELETE SET NULL,
    artist_id    BINARY(16)   REFERENCES artists(id) ON DELETE SET NULL,
    mbid         VARCHAR(36) UNIQUE,
    title        VARCHAR(500) NOT NULL,
    sort_title   VARCHAR(500),
    release_date DATE,
    release_year INT,
    album_type   VARCHAR(20)  NOT NULL DEFAULT 'Album',
    cover_path   TEXT,
    genres       JSON         NOT NULL DEFAULT (JSON_ARRAY()),
    label        VARCHAR(255),
    track_count  INT          NOT NULL DEFAULT 0,
    duration_secs INT         NOT NULL DEFAULT 0,
    meta_status  VARCHAR(15)  NOT NULL DEFAULT 'pending_meta',
    meta_retries INT          NOT NULL DEFAULT 0,
    meta_locked  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                              ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_albums_lib     ON albums(library_id);
CREATE INDEX idx_media_albums_artist  ON albums(artist_id);
CREATE INDEX idx_media_albums_release ON albums(release_year);
CREATE INDEX idx_media_albums_libartist ON albums(library_id, artist_id);

CREATE TABLE tracks (
    id                 BINARY(16)   NOT NULL PRIMARY KEY,
    album_id           BINARY(16)   REFERENCES albums(id) ON DELETE SET NULL,
    artist_id          BINARY(16)   REFERENCES artists(id) ON DELETE SET NULL,
    library_id         BINARY(16)   REFERENCES libraries(id) ON DELETE SET NULL,
    mbid               VARCHAR(36),
    file_path          VARCHAR(768) NOT NULL UNIQUE,
    file_size          BIGINT       NOT NULL DEFAULT 0,
    title              VARCHAR(500) NOT NULL,
    track_number       INT,
    disc_number        INT          NOT NULL DEFAULT 1,
    duration_secs      INT          NOT NULL DEFAULT 0,
    codec              VARCHAR(20),
    bitrate            INT,
    sample_rate        INT,
    bit_depth          INT,
    channels           INT          NOT NULL DEFAULT 2,
    composer           VARCHAR(500),
    lyricist           VARCHAR(500),
    bpm                INT,
    lyrics             TEXT,
    replay_gain_track  DOUBLE,
    replay_gain_album  DOUBLE,
    meta_status        VARCHAR(15)  NOT NULL DEFAULT 'ready',
    play_count         INT          NOT NULL DEFAULT 0,
    lyrics_source      TEXT,
    lyrics_synced      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at         DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at         DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                    ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_tracks_album  ON tracks(album_id, disc_number, track_number);
CREATE INDEX idx_media_tracks_artist ON tracks(artist_id);
CREATE INDEX idx_media_tracks_lib    ON tracks(library_id);
CREATE INDEX idx_media_tracks_title  ON tracks(title);

CREATE TABLE playlists (
    id            BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id      BINARY(16)   NOT NULL,
    name          VARCHAR(255) NOT NULL,
    description   TEXT,
    cover_path    TEXT,
    playlist_type VARCHAR(15)  NOT NULL DEFAULT 'personal',
    smart_rules   JSON,
    is_public     BOOLEAN      NOT NULL DEFAULT FALSE,
    track_count   INT          NOT NULL DEFAULT 0,
    duration_secs INT          NOT NULL DEFAULT 0,
    created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                               ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_playlists_owner ON playlists(owner_id);

CREATE TABLE playlist_tracks (
    playlist_id BINARY(16)  NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    BINARY(16)  NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
    position    INT         NOT NULL DEFAULT 0,
    added_by    BINARY(16)  NOT NULL,
    added_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (playlist_id, track_id)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_plt_playlist ON playlist_tracks(playlist_id, position);

CREATE TABLE liked_tracks (
    user_id  BINARY(16)  NOT NULL,
    track_id BINARY(16)  NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    liked_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, track_id)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_liked_user ON liked_tracks(user_id, liked_at);

CREATE TABLE video_progress (
    user_id        BINARY(16)  NOT NULL,
    item_type      VARCHAR(10) NOT NULL,
    item_id        BINARY(16)  NOT NULL,
    position_secs  INT         NOT NULL DEFAULT 0,
    duration_secs  INT         NOT NULL DEFAULT 0,
    percent_played DOUBLE      NOT NULL DEFAULT 0,
    is_watched     BOOLEAN     NOT NULL DEFAULT FALSE,
    last_played_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, item_type, item_id)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_vprog_user ON video_progress(user_id, last_played_at);

CREATE TABLE listen_history (
    id            BINARY(16)  NOT NULL PRIMARY KEY,
    user_id       BINARY(16)  NOT NULL,
    track_id      BINARY(16)  NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    listened_secs INT         NOT NULL DEFAULT 0,
    is_complete   BOOLEAN     NOT NULL DEFAULT FALSE,
    played_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_lhist_user  ON listen_history(user_id, played_at);
CREATE INDEX idx_media_lhist_track ON listen_history(track_id);

CREATE TABLE settings (
    setting_key VARCHAR(255) NOT NULL PRIMARY KEY,
    value      TEXT         NOT NULL,
    updated_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                            ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
INSERT INTO settings (setting_key, value) VALUES ('tmdb_api_key', ''), ('tmdb_language', 'fr-FR');

CREATE TABLE watchlist (
    user_id   BINARY(16)  NOT NULL,
    item_type VARCHAR(10) NOT NULL,
    item_id   BINARY(16)  NOT NULL,
    added_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, item_type, item_id)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_media_watchlist_user ON watchlist(user_id, item_type);

CREATE TABLE radio_stations (
    id          BINARY(16)   NOT NULL PRIMARY KEY,
    name        TEXT         NOT NULL,
    stream_url  TEXT         NOT NULL,
    homepage    TEXT,
    favicon     TEXT,
    tags        JSON         NOT NULL DEFAULT (JSON_ARRAY()),
    country     TEXT,
    language    TEXT,
    codec       TEXT,
    bitrate     INT,
    is_builtin  BOOLEAN      NOT NULL DEFAULT FALSE,
    owner_id    BINARY(16),
    slug        VARCHAR(255) UNIQUE,
    click_count BIGINT       NOT NULL DEFAULT 0,
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                             ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_radio_stations_owner ON radio_stations(owner_id);

CREATE TABLE radio_favorites (
    user_id    BINARY(16)  NOT NULL,
    station_id BINARY(16)  NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, station_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE radio_recent (
    user_id    BINARY(16)  NOT NULL,
    station_id BINARY(16)  NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
    played_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, station_id)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_radio_recent_user ON radio_recent(user_id, played_at);

CREATE TABLE tv_channels (
    id          BINARY(16)   NOT NULL PRIMARY KEY,
    name        TEXT         NOT NULL,
    stream_url  TEXT         NOT NULL,
    homepage    TEXT,
    logo        TEXT,
    categories  JSON         NOT NULL DEFAULT (JSON_ARRAY()),
    country     TEXT,
    language    TEXT,
    is_builtin  BOOLEAN      NOT NULL DEFAULT FALSE,
    owner_id    BINARY(16),
    slug        VARCHAR(255) UNIQUE,
    click_count BIGINT       NOT NULL DEFAULT 0,
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                             ON UPDATE CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_tv_channels_owner ON tv_channels(owner_id);

CREATE TABLE tv_favorites (
    user_id    BINARY(16)  NOT NULL,
    channel_id BINARY(16)  NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, channel_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE tv_recent (
    user_id    BINARY(16)  NOT NULL,
    channel_id BINARY(16)  NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
    played_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, channel_id)
) DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_tv_recent_user ON tv_recent(user_id, played_at);
