ALTER TABLE media.movies
    DROP COLUMN IF EXISTS content_rating,
    DROP COLUMN IF EXISTS trailer_key,
    DROP COLUMN IF EXISTS poster_urls;
