-- Irreversible in practice (array element order / decimal precision are lost on
-- the round trip); provided for completeness. Reverts JSONB back to arrays and
-- DOUBLE PRECISION back to the original DECIMAL scales.
ALTER TABLE media.settings RENAME COLUMN setting_key TO key;

ALTER TABLE media.libraries
    ALTER COLUMN shared_user_ids DROP DEFAULT,
    ALTER COLUMN shared_user_ids TYPE UUID[] USING
        ARRAY(SELECT jsonb_array_elements_text(shared_user_ids)::uuid),
    ALTER COLUMN shared_user_ids SET DEFAULT '{}';

ALTER TABLE media.tv_channels
    ALTER COLUMN categories DROP DEFAULT,
    ALTER COLUMN categories TYPE TEXT[] USING
        ARRAY(SELECT jsonb_array_elements_text(categories)),
    ALTER COLUMN categories SET DEFAULT '{}';

ALTER TABLE media.radio_stations
    ALTER COLUMN tags DROP DEFAULT,
    ALTER COLUMN tags TYPE TEXT[] USING ARRAY(SELECT jsonb_array_elements_text(tags)),
    ALTER COLUMN tags SET DEFAULT '{}';

ALTER TABLE media.albums
    ALTER COLUMN genres DROP DEFAULT,
    ALTER COLUMN genres TYPE TEXT[] USING ARRAY(SELECT jsonb_array_elements_text(genres)),
    ALTER COLUMN genres SET DEFAULT '{}';

ALTER TABLE media.artists
    ALTER COLUMN genres DROP DEFAULT,
    ALTER COLUMN genres TYPE TEXT[] USING ARRAY(SELECT jsonb_array_elements_text(genres)),
    ALTER COLUMN genres SET DEFAULT '{}';

ALTER TABLE media.tv_shows
    ALTER COLUMN networks DROP DEFAULT,
    ALTER COLUMN networks TYPE TEXT[] USING ARRAY(SELECT jsonb_array_elements_text(networks)),
    ALTER COLUMN networks SET DEFAULT '{}',
    ALTER COLUMN genres DROP DEFAULT,
    ALTER COLUMN genres TYPE TEXT[] USING ARRAY(SELECT jsonb_array_elements_text(genres)),
    ALTER COLUMN genres SET DEFAULT '{}',
    ALTER COLUMN vote_average TYPE DECIMAL(3,1);

ALTER TABLE media.movies
    ALTER COLUMN poster_urls DROP DEFAULT,
    ALTER COLUMN poster_urls TYPE TEXT[] USING ARRAY(SELECT jsonb_array_elements_text(poster_urls)),
    ALTER COLUMN poster_urls SET DEFAULT '{}',
    ALTER COLUMN production_countries DROP DEFAULT,
    ALTER COLUMN production_countries TYPE TEXT[] USING ARRAY(SELECT jsonb_array_elements_text(production_countries)),
    ALTER COLUMN production_countries SET DEFAULT '{}',
    ALTER COLUMN genres DROP DEFAULT,
    ALTER COLUMN genres TYPE TEXT[] USING ARRAY(SELECT jsonb_array_elements_text(genres)),
    ALTER COLUMN genres SET DEFAULT '{}',
    ALTER COLUMN vote_average TYPE DECIMAL(3,1),
    ALTER COLUMN popularity   TYPE DECIMAL(8,3);

ALTER TABLE media.tv_episodes ALTER COLUMN vote_average TYPE DECIMAL(3,1);
ALTER TABLE media.tracks
    ALTER COLUMN replay_gain_track TYPE DECIMAL(6,2),
    ALTER COLUMN replay_gain_album TYPE DECIMAL(6,2);
ALTER TABLE media.video_progress ALTER COLUMN percent_played TYPE DECIMAL(5,2);
