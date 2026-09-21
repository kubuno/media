ALTER TABLE media.albums   DROP COLUMN IF EXISTS meta_locked;
ALTER TABLE media.artists  DROP COLUMN IF EXISTS meta_locked;
ALTER TABLE media.tv_shows DROP COLUMN IF EXISTS meta_locked;
ALTER TABLE media.movies   DROP COLUMN IF EXISTS meta_locked;
