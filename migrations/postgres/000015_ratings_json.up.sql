-- Multi-source ratings (OMDb relay: Rotten Tomatoes, IMDb, Metacritic),
-- stored as {"imdb": "8.8", "rotten_tomatoes": "87%", "metacritic": "74/100"}.

ALTER TABLE media.movies   ADD COLUMN IF NOT EXISTS ratings_json JSONB NOT NULL DEFAULT '{}';
ALTER TABLE media.tv_shows ADD COLUMN IF NOT EXISTS ratings_json JSONB NOT NULL DEFAULT '{}';
