CREATE TABLE IF NOT EXISTS media.watchlist (
    user_id    UUID        NOT NULL,
    item_type  VARCHAR(10) NOT NULL CHECK (item_type IN ('movie', 'show')),
    item_id    UUID        NOT NULL,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_media_watchlist_user ON media.watchlist (user_id, item_type);
