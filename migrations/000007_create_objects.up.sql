CREATE TABLE IF NOT EXISTS objects (
                                     sha256 CHAR(64) NOT NULL,
                                     object_key VARCHAR(255) NOT NULL,
                                     size BIGINT NOT NULL,
                                     content_type VARCHAR(127) NOT NULL,
                                     refcount INT NOT NULL,
                                     created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

                                     PRIMARY KEY (sha256),
                                     UNIQUE KEY uk_objects_object_key (object_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
