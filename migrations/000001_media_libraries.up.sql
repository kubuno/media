CREATE SCHEMA IF NOT EXISTS media;

CREATE OR REPLACE FUNCTION media.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS media.libraries (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id     UUID,
    name         VARCHAR(255) NOT NULL,
    lib_type     VARCHAR(20)  NOT NULL
                     CHECK (lib_type IN ('movies','shows','music','home_videos')),
    path         TEXT NOT NULL,
    icon         VARCHAR(50)  NOT NULL DEFAULT '🎬',
    color        VARCHAR(7)   NOT NULL DEFAULT '#1a73e8',
    is_shared    BOOLEAN      NOT NULL DEFAULT TRUE,
    item_count   INTEGER      NOT NULL DEFAULT 0,
    last_scan_at TIMESTAMPTZ,
    scan_status  VARCHAR(10)  NOT NULL DEFAULT 'idle'
                     CHECK (scan_status IN ('idle','scanning','error')),
    scan_error   TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_libs_type ON media.libraries(lib_type);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'libraries_updated_at'
    ) THEN
        CREATE TRIGGER libraries_updated_at
            BEFORE UPDATE ON media.libraries
            FOR EACH ROW EXECUTE FUNCTION media.set_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS media.scan_jobs (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    library_id      UUID        NOT NULL REFERENCES media.libraries(id) ON DELETE CASCADE,
    status          VARCHAR(10) NOT NULL DEFAULT 'pending',
    files_found     INTEGER     NOT NULL DEFAULT 0,
    files_processed INTEGER     NOT NULL DEFAULT 0,
    files_added     INTEGER     NOT NULL DEFAULT 0,
    files_updated   INTEGER     NOT NULL DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_scanjobs_lib ON media.scan_jobs(library_id, created_at DESC);
