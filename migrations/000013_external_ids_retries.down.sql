DROP INDEX IF EXISTS media.idx_media_albums_meta_pending;
DROP INDEX IF EXISTS media.idx_media_artists_meta_pending;
DROP INDEX IF EXISTS media.idx_media_shows_meta_pending;
DROP INDEX IF EXISTS media.idx_media_movies_meta_pending;
DROP INDEX IF EXISTS media.idx_media_shows_tvmaze;

ALTER TABLE media.albums   DROP COLUMN IF EXISTS meta_retries;
ALTER TABLE media.artists  DROP COLUMN IF EXISTS meta_retries;
ALTER TABLE media.tv_shows DROP COLUMN IF EXISTS meta_retries;
ALTER TABLE media.tv_shows DROP COLUMN IF EXISTS wikidata_id;
ALTER TABLE media.tv_shows DROP COLUMN IF EXISTS tvmaze_id;
ALTER TABLE media.movies   DROP COLUMN IF EXISTS meta_retries;
ALTER TABLE media.movies   DROP COLUMN IF EXISTS wikidata_id;
