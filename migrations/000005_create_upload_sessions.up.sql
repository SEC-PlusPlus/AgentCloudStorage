CREATE TABLE upload_sessions (
                                 id CHAR(36) NOT NULL,
                                 owner_id BIGINT UNSIGNED NOT NULL,
                                 folder_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
                                 original_name VARCHAR(255) NOT NULL,
                                 object_key VARCHAR(512) NOT NULL,
                                 minio_upload_id VARCHAR(512) NOT NULL,
                                 size BIGINT UNSIGNED NOT NULL,
                                 part_size BIGINT UNSIGNED NOT NULL,
                                 content_type VARCHAR(255) NOT NULL,
                                 status TINYINT UNSIGNED NOT NULL,
                                 file_id BIGINT UNSIGNED NULL,
                                 expires_at DATETIME(3) NOT NULL,
                                 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                                 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),

                                 PRIMARY KEY (id),
                                 UNIQUE KEY uk_upload_sessions_object_key (object_key),
                                 KEY idx_upload_sessions_owner_status (owner_id, status),
                                 KEY idx_upload_sessions_status_expires (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE upload_parts (
                              session_id CHAR(36) NOT NULL,
                              part_number INT UNSIGNED NOT NULL,
                              size BIGINT UNSIGNED NOT NULL,
                              etag VARCHAR(255) NOT NULL,
                              created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

                              PRIMARY KEY (session_id, part_number),
                              CONSTRAINT fk_upload_parts_session
                                  FOREIGN KEY (session_id) REFERENCES upload_sessions(id)
                                      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;