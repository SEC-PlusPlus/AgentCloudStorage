CREATE TABLE IF NOT EXISTS folders (
                                       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                       owner_id BIGINT UNSIGNED NOT NULL,
                                       parent_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
                                       name VARCHAR(255) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (id),
    UNIQUE KEY uk_folders_owner_parent_name (
                                                owner_id,
                                                parent_id,
                                                name
                                            ),
    KEY idx_folders_owner_parent (
                                     owner_id,
                                     parent_id
                                 )
    ) ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4
    COLLATE=utf8mb4_unicode_ci;

ALTER TABLE files
    ADD COLUMN folder_id BIGINT UNSIGNED NOT NULL DEFAULT 0
        AFTER owner_id,
    ADD KEY idx_files_owner_folder_status_created (
        owner_id,
        folder_id,
        status,
        created_at
    );