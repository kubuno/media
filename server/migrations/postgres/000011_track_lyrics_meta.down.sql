ALTER TABLE media.tracks
    DROP COLUMN IF EXISTS lyrics_source,
    DROP COLUMN IF EXISTS lyrics_synced;
