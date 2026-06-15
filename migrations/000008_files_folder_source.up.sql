-- Permet d'utiliser un dossier du module files comme source d'une bibliothèque media.

ALTER TABLE media.libraries
    ADD COLUMN IF NOT EXISTS source_type     VARCHAR(20) NOT NULL DEFAULT 'filesystem'
                               CONSTRAINT libraries_source_type_check
                               CHECK (source_type IN ('filesystem', 'files_folder')),
    ADD COLUMN IF NOT EXISTS files_folder_id UUID,
    ADD COLUMN IF NOT EXISTS files_owner_id  UUID;

COMMENT ON COLUMN media.libraries.source_type IS
    'filesystem = chemin disque manuel ; files_folder = dossier du module files';
COMMENT ON COLUMN media.libraries.files_folder_id IS
    'ID du dossier dans files.folders (NULL si source_type = filesystem)';
COMMENT ON COLUMN media.libraries.files_owner_id IS
    'owner_id du dossier dans files.folders (NULL si source_type = filesystem)';
