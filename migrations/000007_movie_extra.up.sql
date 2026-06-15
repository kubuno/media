ALTER TABLE media.movies
    ADD COLUMN IF NOT EXISTS content_rating VARCHAR(20),
    ADD COLUMN IF NOT EXISTS trailer_key    VARCHAR(100),
    ADD COLUMN IF NOT EXISTS poster_urls    TEXT[] NOT NULL DEFAULT '{}';
