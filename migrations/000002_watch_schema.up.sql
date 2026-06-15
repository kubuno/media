CREATE TABLE IF NOT EXISTS media.movies (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id       UUID        NOT NULL REFERENCES media.libraries(id) ON DELETE CASCADE,
    file_path        TEXT        NOT NULL UNIQUE,
    file_size        BIGINT      NOT NULL DEFAULT 0,
    duration_secs    INTEGER     NOT NULL DEFAULT 0,
    video_codec      VARCHAR(50),
    audio_codec      VARCHAR(50),
    resolution_w     INTEGER,
    resolution_h     INTEGER,
    tmdb_id          INTEGER,
    imdb_id          VARCHAR(20),
    title            VARCHAR(500) NOT NULL,
    original_title   VARCHAR(500),
    overview         TEXT,
    tagline          VARCHAR(500),
    release_date     DATE,
    runtime_mins     INTEGER,
    poster_path      TEXT,
    backdrop_path    TEXT,
    vote_average     DECIMAL(3,1),
    vote_count       INTEGER,
    popularity       DECIMAL(8,3),
    genres           TEXT[]      NOT NULL DEFAULT '{}',
    original_language VARCHAR(10),
    production_countries TEXT[]  NOT NULL DEFAULT '{}',
    meta_status      VARCHAR(15) NOT NULL DEFAULT 'pending_meta',
    cast_json        JSONB       NOT NULL DEFAULT '[]',
    crew_json        JSONB       NOT NULL DEFAULT '[]',
    subtitles        JSONB       NOT NULL DEFAULT '[]',
    transcode_status JSONB       NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_movies_lib        ON media.movies(library_id);
CREATE INDEX IF NOT EXISTS idx_media_movies_tmdb       ON media.movies(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_media_movies_release    ON media.movies(release_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_media_movies_popularity ON media.movies(popularity DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_media_movies_genres     ON media.movies USING GIN(genres);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'movies_updated_at') THEN
        CREATE TRIGGER movies_updated_at
            BEFORE UPDATE ON media.movies
            FOR EACH ROW EXECUTE FUNCTION media.set_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS media.tv_shows (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id        UUID        NOT NULL REFERENCES media.libraries(id) ON DELETE CASCADE,
    tmdb_id           INTEGER     UNIQUE,
    tvdb_id           INTEGER,
    name              VARCHAR(500) NOT NULL,
    original_name     VARCHAR(500),
    overview          TEXT,
    tagline           VARCHAR(500),
    first_air_date    DATE,
    last_air_date     DATE,
    status            VARCHAR(50),
    poster_path       TEXT,
    backdrop_path     TEXT,
    vote_average      DECIMAL(3,1),
    vote_count        INTEGER,
    genres            TEXT[]      NOT NULL DEFAULT '{}',
    networks          TEXT[]      NOT NULL DEFAULT '{}',
    season_count      INTEGER     NOT NULL DEFAULT 0,
    episode_count     INTEGER     NOT NULL DEFAULT 0,
    original_language VARCHAR(10),
    cast_json         JSONB       NOT NULL DEFAULT '[]',
    crew_json         JSONB       NOT NULL DEFAULT '[]',
    meta_status       VARCHAR(15) NOT NULL DEFAULT 'pending_meta',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_shows_lib    ON media.tv_shows(library_id);
CREATE INDEX IF NOT EXISTS idx_media_shows_tmdb   ON media.tv_shows(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_media_shows_genres ON media.tv_shows USING GIN(genres);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tv_shows_updated_at') THEN
        CREATE TRIGGER tv_shows_updated_at
            BEFORE UPDATE ON media.tv_shows
            FOR EACH ROW EXECUTE FUNCTION media.set_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS media.tv_seasons (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    show_id       UUID        NOT NULL REFERENCES media.tv_shows(id) ON DELETE CASCADE,
    tmdb_id       INTEGER,
    season_number INTEGER     NOT NULL,
    name          VARCHAR(500),
    overview      TEXT,
    air_date      DATE,
    poster_path   TEXT,
    episode_count INTEGER     NOT NULL DEFAULT 0,
    UNIQUE (show_id, season_number)
);

CREATE INDEX IF NOT EXISTS idx_media_seasons_show ON media.tv_seasons(show_id, season_number);

CREATE TABLE IF NOT EXISTS media.tv_episodes (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    season_id      UUID        NOT NULL REFERENCES media.tv_seasons(id) ON DELETE CASCADE,
    show_id        UUID        NOT NULL REFERENCES media.tv_shows(id) ON DELETE CASCADE,
    file_path      TEXT        UNIQUE,
    file_size      BIGINT,
    tmdb_id        INTEGER,
    episode_number INTEGER     NOT NULL,
    name           VARCHAR(500),
    overview       TEXT,
    air_date       DATE,
    still_path     TEXT,
    vote_average   DECIMAL(3,1),
    duration_secs  INTEGER,
    video_codec    VARCHAR(50),
    audio_codec    VARCHAR(50),
    resolution_w   INTEGER,
    resolution_h   INTEGER,
    subtitles      JSONB       NOT NULL DEFAULT '[]',
    transcode_status JSONB     NOT NULL DEFAULT '{}',
    meta_status    VARCHAR(15) NOT NULL DEFAULT 'pending_meta',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (season_id, episode_number)
);

CREATE INDEX IF NOT EXISTS idx_media_episodes_season ON media.tv_episodes(season_id, episode_number);
CREATE INDEX IF NOT EXISTS idx_media_episodes_show   ON media.tv_episodes(show_id);
CREATE INDEX IF NOT EXISTS idx_media_episodes_file   ON media.tv_episodes(file_path) WHERE file_path IS NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tv_episodes_updated_at') THEN
        CREATE TRIGGER tv_episodes_updated_at
            BEFORE UPDATE ON media.tv_episodes
            FOR EACH ROW EXECUTE FUNCTION media.set_updated_at();
    END IF;
END $$;
