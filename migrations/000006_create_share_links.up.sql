CREATE TABLE IF NOT EXISTS share_links (
                                     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                     token CHAR(43) NOT NULL,
                                     owner_id BIGINT UNSIGNED NOT NULL,
                                     file_id BIGINT UNSIGNED NOT NULL,
                                     display_name VARCHAR(255) NOT NULL,
                                     password_hash VARCHAR(60) NULL,
                                     expires_at DATETIME(3) NULL,
                                     download_count INT NOT NULL DEFAULT 0,
                                     revoked_at DATETIME(3) NULL,
                                     created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                                     updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                     ON UPDATE CURRENT_TIMESTAMP(3),

                                     PRIMARY KEY (id),
                                     UNIQUE KEY uk_token (token),
                                     KEY idx_owner (owner_id, created_at),
                                     KEY idx_file (file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
