-- Web TV: live television channels (HLS streams), mirroring the web radio
-- feature. Builtin channels are seeded at startup with a stable `slug`;
-- user-added channels carry an `owner_id`.

CREATE TABLE IF NOT EXISTS media.tv_channels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    stream_url  TEXT        NOT NULL,
    homepage    TEXT,
    logo        TEXT,
    categories  TEXT[]      NOT NULL DEFAULT '{}',
    country     TEXT,
    language    TEXT,
    -- Builtin (curated) channels: is_builtin = TRUE, owner_id = NULL, slug set.
    is_builtin  BOOLEAN     NOT NULL DEFAULT FALSE,
    owner_id    UUID,
    slug        TEXT        UNIQUE,
    click_count BIGINT      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tv_channels_owner ON media.tv_channels(owner_id);
CREATE INDEX IF NOT EXISTS idx_tv_channels_cats  ON media.tv_channels USING GIN(categories);

CREATE TABLE IF NOT EXISTS media.tv_favorites (
    user_id    UUID        NOT NULL,
    channel_id UUID        NOT NULL REFERENCES media.tv_channels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS media.tv_recent (
    user_id    UUID        NOT NULL,
    channel_id UUID        NOT NULL REFERENCES media.tv_channels(id) ON DELETE CASCADE,
    played_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_tv_recent_user ON media.tv_recent(user_id, played_at DESC);
