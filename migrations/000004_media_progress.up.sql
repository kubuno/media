CREATE TABLE IF NOT EXISTS media.video_progress (
    user_id        UUID        NOT NULL,
    item_type      VARCHAR(10) NOT NULL,
    item_id        UUID        NOT NULL,
    position_secs  INTEGER     NOT NULL DEFAULT 0,
    duration_secs  INTEGER     NOT NULL DEFAULT 0,
    percent_played DECIMAL(5,2) NOT NULL DEFAULT 0,
    is_watched     BOOLEAN     NOT NULL DEFAULT FALSE,
    last_played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_media_vprog_user      ON media.video_progress(user_id, last_played_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_vprog_unwatched ON media.video_progress(user_id)
    WHERE is_watched = FALSE AND percent_played > 0;

CREATE TABLE IF NOT EXISTS media.listen_history (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID        NOT NULL,
    track_id      UUID        NOT NULL REFERENCES media.tracks(id) ON DELETE CASCADE,
    listened_secs INTEGER     NOT NULL DEFAULT 0,
    is_complete   BOOLEAN     NOT NULL DEFAULT FALSE,
    played_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_lhist_user  ON media.listen_history(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_lhist_track ON media.listen_history(track_id);
