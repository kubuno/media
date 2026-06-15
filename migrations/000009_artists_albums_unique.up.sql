-- Step 1: merge duplicate artists (same library + same name case-insensitively)
-- For each group of duplicates, keep the one with the most tracks and reassign
-- all tracks and albums from the others to the survivor.
DO $$
DECLARE
    dup RECORD;
    keep_id UUID;
BEGIN
    FOR dup IN
        SELECT library_id, lower(name) AS lname
        FROM media.artists
        GROUP BY library_id, lower(name)
        HAVING COUNT(*) > 1
    LOOP
        -- Pick the artist with the highest track_count as the canonical one
        SELECT id INTO keep_id
        FROM media.artists
        WHERE library_id = dup.library_id AND lower(name) = dup.lname
        ORDER BY track_count DESC, id
        LIMIT 1;

        -- Reassign tracks from duplicates to canonical artist
        UPDATE media.tracks
        SET artist_id = keep_id
        WHERE artist_id IN (
            SELECT id FROM media.artists
            WHERE library_id = dup.library_id AND lower(name) = dup.lname
              AND id <> keep_id
        );

        -- Reassign albums from duplicates to canonical artist
        UPDATE media.albums
        SET artist_id = keep_id
        WHERE artist_id IN (
            SELECT id FROM media.artists
            WHERE library_id = dup.library_id AND lower(name) = dup.lname
              AND id <> keep_id
        );

        -- Delete the now-empty duplicates
        DELETE FROM media.artists
        WHERE library_id = dup.library_id AND lower(name) = dup.lname
          AND id <> keep_id;
    END LOOP;
END;
$$;

-- Step 2: merge duplicate albums (same library + same artist + same title)
DO $$
DECLARE
    dup RECORD;
    keep_id UUID;
BEGIN
    -- Duplicates with non-null artist_id
    FOR dup IN
        SELECT library_id, artist_id, lower(title) AS ltitle
        FROM media.albums
        WHERE artist_id IS NOT NULL
        GROUP BY library_id, artist_id, lower(title)
        HAVING COUNT(*) > 1
    LOOP
        SELECT id INTO keep_id
        FROM media.albums
        WHERE library_id = dup.library_id AND artist_id = dup.artist_id
          AND lower(title) = dup.ltitle
        ORDER BY track_count DESC, id
        LIMIT 1;

        UPDATE media.tracks
        SET album_id = keep_id
        WHERE album_id IN (
            SELECT id FROM media.albums
            WHERE library_id = dup.library_id AND artist_id = dup.artist_id
              AND lower(title) = dup.ltitle AND id <> keep_id
        );

        DELETE FROM media.albums
        WHERE library_id = dup.library_id AND artist_id = dup.artist_id
          AND lower(title) = dup.ltitle AND id <> keep_id;
    END LOOP;

    -- Duplicates with null artist_id
    FOR dup IN
        SELECT library_id, lower(title) AS ltitle
        FROM media.albums
        WHERE artist_id IS NULL
        GROUP BY library_id, lower(title)
        HAVING COUNT(*) > 1
    LOOP
        SELECT id INTO keep_id
        FROM media.albums
        WHERE library_id = dup.library_id AND artist_id IS NULL
          AND lower(title) = dup.ltitle
        ORDER BY track_count DESC, id
        LIMIT 1;

        UPDATE media.tracks
        SET album_id = keep_id
        WHERE album_id IN (
            SELECT id FROM media.albums
            WHERE library_id = dup.library_id AND artist_id IS NULL
              AND lower(title) = dup.ltitle AND id <> keep_id
        );

        DELETE FROM media.albums
        WHERE library_id = dup.library_id AND artist_id IS NULL
          AND lower(title) = dup.ltitle AND id <> keep_id;
    END LOOP;
END;
$$;

-- Step 3: create unique indexes (now safe, no more duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_artists_lib_name
    ON media.artists (library_id, lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_albums_lib_artist_title
    ON media.albums (library_id, artist_id, lower(title))
    WHERE artist_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_albums_lib_null_artist_title
    ON media.albums (library_id, lower(title))
    WHERE artist_id IS NULL;
