-- Web radio: internet radio stations (Icecast/Shoutcast/HTTP streams), per-user
-- favorites and recent history. Builtin stations are seeded at startup and have
-- a stable `slug`; user-added stations carry an `owner_id`.

CREATE TABLE IF NOT EXISTS media.radio_stations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    stream_url  TEXT        NOT NULL,
    homepage    TEXT,
    favicon     TEXT,
    tags        TEXT[]      NOT NULL DEFAULT '{}',
    country     TEXT,
    language    TEXT,
    codec       TEXT,
    bitrate     INTEGER,
    -- Builtin (curated) stations: is_builtin = TRUE, owner_id = NULL, slug set.
    is_builtin  BOOLEAN     NOT NULL DEFAULT FALSE,
    owner_id    UUID,
    slug        TEXT        UNIQUE,
    click_count BIGINT      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_radio_stations_owner ON media.radio_stations(owner_id);
CREATE INDEX IF NOT EXISTS idx_radio_stations_tags  ON media.radio_stations USING GIN(tags);

CREATE TABLE IF NOT EXISTS media.radio_favorites (
    user_id    UUID        NOT NULL,
    station_id UUID        NOT NULL REFERENCES media.radio_stations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, station_id)
);

CREATE TABLE IF NOT EXISTS media.radio_recent (
    user_id    UUID        NOT NULL,
    station_id UUID        NOT NULL REFERENCES media.radio_stations(id) ON DELETE CASCADE,
    played_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, station_id)
);

CREATE INDEX IF NOT EXISTS idx_radio_recent_user ON media.radio_recent(user_id, played_at DESC);
