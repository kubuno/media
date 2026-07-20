-- Metadata lock: locked items are skipped by the enrichment
-- workers and refuse refresh/dissociate until unlocked.

ALTER TABLE media.movies   ADD COLUMN IF NOT EXISTS meta_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE media.tv_shows ADD COLUMN IF NOT EXISTS meta_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE media.artists  ADD COLUMN IF NOT EXISTS meta_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE media.albums   ADD COLUMN IF NOT EXISTS meta_locked BOOLEAN NOT NULL DEFAULT FALSE;
