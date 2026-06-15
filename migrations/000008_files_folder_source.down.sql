ALTER TABLE media.libraries
    DROP COLUMN IF EXISTS files_owner_id,
    DROP COLUMN IF EXISTS files_folder_id,
    DROP COLUMN IF EXISTS source_type;
