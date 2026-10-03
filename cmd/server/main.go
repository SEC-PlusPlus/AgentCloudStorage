package main

import (
	"PersonalCloudStorage/internal/auth"
	"PersonalCloudStorage/internal/database"
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/folder"
	"PersonalCloudStorage/internal/httpapi"
	"PersonalCloudStorage/internal/storage"
	"PersonalCloudStorage/internal/user"
	"log"
	"os"
	"time"
)

func main() {
	objectStorage, err := storage.NewMinIO(storage.MinIOConfig{
		Endpoint:  os.Getenv("MINIO_ENDPOINT"),
		AccessKey: os.Getenv("MINIO_ACCESS_KEY"),
		SecretKey: os.Getenv("MINIO_SECRET_KEY"),
		Bucket:    "govault",
		UseSSL:    false,
	})

	if err != nil {
		log.Fatal("创建MinIO存储失败:", err)
	}

	db, err := database.OpenMySQL(os.Getenv("MYSQL_DSN"))
	if err != nil {
		log.Fatal("连接MySQL失败:", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal("获取数据库连接池失败:", err)
	}
	defer sqlDB.Close()

	folderRepository := folder.NewGORMRepository(db)
	fileRepository := file.NewGORMRepository(db)

	folderService := folder.NewService(
		folderRepository,
		fileRepository,
	)
	folderHandler := httpapi.NewFolderHandler(folderService)

	fileService := file.NewService(
		objectStorage,
		fileRepository,
		folderService,
	)
	fileHandler := httpapi.NewFileHandler(fileService)

	userRepository := user.NewGORMRepository(db)
	userService := user.NewService(userRepository)
	tokenManager, err := auth.NewTokenManager(auth.TokenConfig{
		Secret:    os.Getenv("JWT_SECRET"),
		Issuer:    "govault",
		AccessTTL: 2 * time.Hour,
	})
	if err != nil {
		log.Fatal("创建JWT管理器失败:", err)
	}

	authHandler := httpapi.NewAuthHandler(
		userService,
		tokenManager,
	)

	router := httpapi.NewRouter(
		fileHandler,
		folderHandler,
		authHandler,
		tokenManager,
	)

	if err := router.Run(":8080"); err != nil {
		log.Fatal("启动HTTP服务失败:", err)
	}
}
