CREATE TABLE IF NOT EXISTS media.artists (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id  UUID        REFERENCES media.libraries(id) ON DELETE SET NULL,
    mbid        VARCHAR(36) UNIQUE,
    name        VARCHAR(500) NOT NULL,
    sort_name   VARCHAR(500),
    biography   TEXT,
    image_path  TEXT,
    genres      TEXT[]      NOT NULL DEFAULT '{}',
    country     VARCHAR(100),
    begin_date  DATE,
    end_date    DATE,
    artist_type VARCHAR(20),
    album_count INTEGER     NOT NULL DEFAULT 0,
    track_count INTEGER     NOT NULL DEFAULT 0,
    meta_status VARCHAR(15) NOT NULL DEFAULT 'pending_meta',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_artists_lib  ON media.artists(library_id);
CREATE INDEX IF NOT EXISTS idx_media_artists_name ON media.artists(sort_name ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_media_artists_mbid ON media.artists(mbid) WHERE mbid IS NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'artists_updated_at') THEN
        CREATE TRIGGER artists_updated_at
            BEFORE UPDATE ON media.artists
            FOR EACH ROW EXECUTE FUNCTION media.set_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS media.albums (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id   UUID        REFERENCES media.libraries(id) ON DELETE SET NULL,
    artist_id    UUID        REFERENCES media.artists(id) ON DELETE SET NULL,
    mbid         VARCHAR(36) UNIQUE,
    title        VARCHAR(500) NOT NULL,
    sort_title   VARCHAR(500),
    release_date DATE,
    release_year INTEGER,
    album_type   VARCHAR(20) NOT NULL DEFAULT 'Album',
    cover_path   TEXT,
    genres       TEXT[]      NOT NULL DEFAULT '{}',
    label        VARCHAR(255),
    track_count  INTEGER     NOT NULL DEFAULT 0,
    duration_secs INTEGER    NOT NULL DEFAULT 0,
    meta_status  VARCHAR(15) NOT NULL DEFAULT 'pending_meta',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_albums_lib     ON media.albums(library_id);
CREATE INDEX IF NOT EXISTS idx_media_albums_artist  ON media.albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_media_albums_release ON media.albums(release_year DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_media_albums_mbid    ON media.albums(mbid) WHERE mbid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_albums_genres  ON media.albums USING GIN(genres);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'albums_updated_at') THEN
        CREATE TRIGGER albums_updated_at
            BEFORE UPDATE ON media.albums
            FOR EACH ROW EXECUTE FUNCTION media.set_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS media.tracks (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    album_id           UUID        REFERENCES media.albums(id) ON DELETE SET NULL,
    artist_id          UUID        REFERENCES media.artists(id) ON DELETE SET NULL,
    library_id         UUID        REFERENCES media.libraries(id) ON DELETE SET NULL,
    mbid               VARCHAR(36),
    file_path          TEXT        NOT NULL UNIQUE,
    file_size          BIGINT      NOT NULL DEFAULT 0,
    title              VARCHAR(500) NOT NULL,
    track_number       INTEGER,
    disc_number        INTEGER     NOT NULL DEFAULT 1,
    duration_secs      INTEGER     NOT NULL DEFAULT 0,
    codec              VARCHAR(20),
    bitrate            INTEGER,
    sample_rate        INTEGER,
    bit_depth          INTEGER,
    channels           INTEGER     NOT NULL DEFAULT 2,
    composer           VARCHAR(500),
    lyricist           VARCHAR(500),
    bpm                INTEGER,
    lyrics             TEXT,
    replay_gain_track  DECIMAL(6,2),
    replay_gain_album  DECIMAL(6,2),
    meta_status        VARCHAR(15) NOT NULL DEFAULT 'ready',
    play_count         INTEGER     NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_tracks_album  ON media.tracks(album_id, disc_number, track_number);
CREATE INDEX IF NOT EXISTS idx_media_tracks_artist ON media.tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_media_tracks_lib    ON media.tracks(library_id);
CREATE INDEX IF NOT EXISTS idx_media_tracks_title  ON media.tracks(title ASC);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tracks_updated_at') THEN
        CREATE TRIGGER tracks_updated_at
            BEFORE UPDATE ON media.tracks
            FOR EACH ROW EXECUTE FUNCTION media.set_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS media.playlists (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id      UUID        NOT NULL,
    name          VARCHAR(255) NOT NULL,
    description   TEXT,
    cover_path    TEXT,
    playlist_type VARCHAR(15) NOT NULL DEFAULT 'personal',
    smart_rules   JSONB,
    is_public     BOOLEAN     NOT NULL DEFAULT FALSE,
    track_count   INTEGER     NOT NULL DEFAULT 0,
    duration_secs INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_playlists_owner ON media.playlists(owner_id);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'playlists_updated_at') THEN
        CREATE TRIGGER playlists_updated_at
            BEFORE UPDATE ON media.playlists
            FOR EACH ROW EXECUTE FUNCTION media.set_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS media.playlist_tracks (
    playlist_id UUID        NOT NULL REFERENCES media.playlists(id) ON DELETE CASCADE,
    track_id    UUID        NOT NULL REFERENCES media.tracks(id)    ON DELETE CASCADE,
    position    INTEGER     NOT NULL DEFAULT 0,
    added_by    UUID        NOT NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_media_plt_playlist ON media.playlist_tracks(playlist_id, position);

CREATE TABLE IF NOT EXISTS media.liked_tracks (
    user_id  UUID        NOT NULL,
    track_id UUID        NOT NULL REFERENCES media.tracks(id) ON DELETE CASCADE,
    liked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_media_liked_user ON media.liked_tracks(user_id, liked_at DESC);
