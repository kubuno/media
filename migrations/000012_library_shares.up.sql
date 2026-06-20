-- Explicit per-library sharing with specific users (in addition to the owner
-- and the `is_shared` "everyone" flag). Stores core.users ids the library is
-- shared with.
ALTER TABLE media.libraries
    ADD COLUMN IF NOT EXISTS shared_user_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN media.libraries.shared_user_ids IS
    'IDs (core.users) des utilisateurs avec qui la bibliothèque est partagée explicitement.';
