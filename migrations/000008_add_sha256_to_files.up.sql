ALTER TABLE files
    ADD COLUMN sha256 CHAR(64) NULL;

CREATE INDEX idx_files_sha256 ON files (sha256);

-- Dedup lets several files rows share one objects.object_key, so the old
-- per-row UNIQUE on object_key must go (instant-upload spec §2.2).
-- Forward-only: re-adding it is impossible once shared keys exist (spec §7).
ALTER TABLE files
    DROP INDEX uk_files_object_key;
