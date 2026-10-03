ALTER TABLE users
    ADD COLUMN quota_bytes BIGINT UNSIGNED NOT NULL DEFAULT 1073741824,
    ADD COLUMN used_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN reserved_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0;

UPDATE users AS u
    LEFT JOIN (
    SELECT owner_id, SUM(size) AS total_bytes
    FROM files
    GROUP BY owner_id
    ) AS f ON f.owner_id = u.id
    SET u.used_bytes = COALESCE(f.total_bytes, 0);