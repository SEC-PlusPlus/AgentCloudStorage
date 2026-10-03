CREATE TABLE IF NOT EXISTS files (
                                     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                     owner_id BIGINT UNSIGNED NOT NULL,
                                     original_name VARCHAR(255) NOT NULL,
    object_key VARCHAR(512) NOT NULL,
    size BIGINT UNSIGNED NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    etag VARCHAR(128) NOT NULL,
    status TINYINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
    deleted_at DATETIME(3) NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_files_object_key (object_key),
    KEY idx_files_owner_status_created_at (owner_id, status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;