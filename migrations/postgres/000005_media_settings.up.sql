CREATE TABLE IF NOT EXISTS media.settings (
    key        VARCHAR(255) PRIMARY KEY,
    value      TEXT         NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO media.settings (key, value) VALUES
    ('tmdb_api_key', ''),
    ('tmdb_language', 'fr-FR')
ON CONFLICT DO NOTHING;
