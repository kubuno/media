-- Cache the provenance of fetched lyrics so the player can credit the source,
-- and remember whether the cached lyrics are time-synced (LRC) or plain text.
ALTER TABLE media.tracks
    ADD COLUMN IF NOT EXISTS lyrics_source TEXT,
    ADD COLUMN IF NOT EXISTS lyrics_synced BOOLEAN NOT NULL DEFAULT FALSE;
