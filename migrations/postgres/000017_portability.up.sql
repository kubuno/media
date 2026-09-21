-- Portability migration: bring the PostgreSQL schema to a shape the same Rust
-- code can also run on MySQL and SQLite (kubuno-db, three engines at run time).
--
--   * TEXT[]/UUID[] array columns -> JSONB arrays (MySQL and SQLite have no
--     array type; the module reads them through `#[sqlx(json)]` / JsonVec and
--     writes a Vec<_> as JSON). The GIN indexes on those columns are dropped.
--   * DECIMAL columns read as `f64` -> DOUBLE PRECISION, so the one decode path
--     works on every engine (SQLite has no DECIMAL; sqlx decodes NUMERIC to
--     BigDecimal, not f64).
--
-- Existing PostgreSQL installs migrate in place; MySQL/SQLite declare the final
-- shape directly in their own 000001 file.

-- ── array columns -> JSONB ──────────────────────────────────────────────────
DROP INDEX IF EXISTS media.idx_media_movies_genres;
DROP INDEX IF EXISTS media.idx_media_shows_genres;
DROP INDEX IF EXISTS media.idx_media_albums_genres;
DROP INDEX IF EXISTS media.idx_radio_stations_tags;
DROP INDEX IF EXISTS media.idx_tv_channels_cats;

ALTER TABLE media.movies
    ALTER COLUMN genres               DROP DEFAULT,
    ALTER COLUMN genres               TYPE JSONB USING to_jsonb(genres),
    ALTER COLUMN genres               SET DEFAULT '[]'::jsonb,
    ALTER COLUMN production_countries DROP DEFAULT,
    ALTER COLUMN production_countries TYPE JSONB USING to_jsonb(production_countries),
    ALTER COLUMN production_countries SET DEFAULT '[]'::jsonb,
    ALTER COLUMN poster_urls          DROP DEFAULT,
    ALTER COLUMN poster_urls          TYPE JSONB USING to_jsonb(poster_urls),
    ALTER COLUMN poster_urls          SET DEFAULT '[]'::jsonb;

ALTER TABLE media.tv_shows
    ALTER COLUMN genres   DROP DEFAULT,
    ALTER COLUMN genres   TYPE JSONB USING to_jsonb(genres),
    ALTER COLUMN genres   SET DEFAULT '[]'::jsonb,
    ALTER COLUMN networks DROP DEFAULT,
    ALTER COLUMN networks TYPE JSONB USING to_jsonb(networks),
    ALTER COLUMN networks SET DEFAULT '[]'::jsonb;

ALTER TABLE media.artists
    ALTER COLUMN genres DROP DEFAULT,
    ALTER COLUMN genres TYPE JSONB USING to_jsonb(genres),
    ALTER COLUMN genres SET DEFAULT '[]'::jsonb;

ALTER TABLE media.albums
    ALTER COLUMN genres DROP DEFAULT,
    ALTER COLUMN genres TYPE JSONB USING to_jsonb(genres),
    ALTER COLUMN genres SET DEFAULT '[]'::jsonb;

ALTER TABLE media.radio_stations
    ALTER COLUMN tags DROP DEFAULT,
    ALTER COLUMN tags TYPE JSONB USING to_jsonb(tags),
    ALTER COLUMN tags SET DEFAULT '[]'::jsonb;

ALTER TABLE media.tv_channels
    ALTER COLUMN categories DROP DEFAULT,
    ALTER COLUMN categories TYPE JSONB USING to_jsonb(categories),
    ALTER COLUMN categories SET DEFAULT '[]'::jsonb;

ALTER TABLE media.libraries
    ALTER COLUMN shared_user_ids DROP DEFAULT,
    ALTER COLUMN shared_user_ids TYPE JSONB USING to_jsonb(shared_user_ids),
    ALTER COLUMN shared_user_ids SET DEFAULT '[]'::jsonb;

-- ── DECIMAL -> DOUBLE PRECISION (columns decoded as f64) ────────────────────
ALTER TABLE media.movies
    ALTER COLUMN vote_average TYPE DOUBLE PRECISION,
    ALTER COLUMN popularity   TYPE DOUBLE PRECISION;

ALTER TABLE media.tv_shows
    ALTER COLUMN vote_average TYPE DOUBLE PRECISION;

ALTER TABLE media.tv_episodes
    ALTER COLUMN vote_average TYPE DOUBLE PRECISION;

ALTER TABLE media.tracks
    ALTER COLUMN replay_gain_track TYPE DOUBLE PRECISION,
    ALTER COLUMN replay_gain_album TYPE DOUBLE PRECISION;

ALTER TABLE media.video_progress
    ALTER COLUMN percent_played TYPE DOUBLE PRECISION;

-- `key` is a reserved word on MySQL; rename to a portable identifier so the one
-- shared query text needs no per-engine quoting.
ALTER TABLE media.settings RENAME COLUMN key TO setting_key;
