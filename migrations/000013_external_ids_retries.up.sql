-- External provider IDs + retry counters for the metadata pipeline.
-- Stable IDs let refreshes re-match by ID instead of by title.

ALTER TABLE media.movies   ADD COLUMN IF NOT EXISTS wikidata_id  VARCHAR(20);
ALTER TABLE media.movies   ADD COLUMN IF NOT EXISTS meta_retries INTEGER NOT NULL DEFAULT 0;

ALTER TABLE media.tv_shows ADD COLUMN IF NOT EXISTS tvmaze_id    INTEGER;
ALTER TABLE media.tv_shows ADD COLUMN IF NOT EXISTS wikidata_id  VARCHAR(20);
ALTER TABLE media.tv_shows ADD COLUMN IF NOT EXISTS meta_retries INTEGER NOT NULL DEFAULT 0;

ALTER TABLE media.artists  ADD COLUMN IF NOT EXISTS meta_retries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media.albums   ADD COLUMN IF NOT EXISTS meta_retries INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_media_shows_tvmaze ON media.tv_shows(tvmaze_id) WHERE tvmaze_id IS NOT NULL;

-- Partial indexes so the enrichment pollers stay cheap on big libraries.
CREATE INDEX IF NOT EXISTS idx_media_movies_meta_pending  ON media.movies(meta_status)   WHERE meta_status IN ('pending_meta', 'error_meta');
CREATE INDEX IF NOT EXISTS idx_media_shows_meta_pending   ON media.tv_shows(meta_status) WHERE meta_status IN ('pending_meta', 'error_meta');
CREATE INDEX IF NOT EXISTS idx_media_artists_meta_pending ON media.artists(meta_status)  WHERE meta_status IN ('pending_meta', 'error_meta');
CREATE INDEX IF NOT EXISTS idx_media_albums_meta_pending  ON media.albums(meta_status)   WHERE meta_status IN ('pending_meta', 'error_meta');
