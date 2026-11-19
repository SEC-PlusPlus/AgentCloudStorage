package main

import (
	"PersonalCloudStorage/internal/auth"
	"PersonalCloudStorage/internal/config"
	"PersonalCloudStorage/internal/database"
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/folder"
	"PersonalCloudStorage/internal/httpapi"
	"PersonalCloudStorage/internal/knowledge"
	"PersonalCloudStorage/internal/storage"
	"PersonalCloudStorage/internal/upload"
	"PersonalCloudStorage/internal/user"
	"context"
	"log"
	"log/slog"
	"strings"
	"time"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal("读取配置失败:", err)
	}

	objectStorage, err := storage.NewMinIO(storage.MinIOConfig{
		Endpoint:  cfg.MinIO.Endpoint,
		AccessKey: cfg.MinIO.AccessKey,
		SecretKey: cfg.MinIO.SecretKey,
		Bucket:    cfg.MinIO.Bucket,
		UseSSL:    cfg.MinIO.UseSSL,
	})

	if err != nil {
		log.Fatal("创建MinIO存储失败:", err)
	}

	db, err := database.OpenMySQLWithPool(cfg.MySQL.ConnectionString(), database.PoolConfig{
		MaxOpenConns:    cfg.MySQL.MaxOpenConns,
		MaxIdleConns:    cfg.MySQL.MaxIdleConns,
		ConnMaxIdleTime: cfg.MySQL.ConnMaxIdleTime,
	})
	if err != nil {
		log.Fatal("连接MySQL失败:", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal("获取数据库连接池失败:", err)
	}
	defer sqlDB.Close()
	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	defer redisClient.Close()
	pingCtx, cancelPing := context.WithTimeout(context.Background(), 3*time.Second)
	err = redisClient.Ping(pingCtx).Err()
	cancelPing()
	if err != nil {
		log.Fatal("连接Redis失败:", err)
	}

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

	// Task 9 双档降级：agent.base_url 已配置时 remote 为 primary；
	// AI 配置完整则再构造 local 档组成 composite，否则仅 remote 并响亮 Warn。
	var answerer knowledge.Answerer
	if strings.TrimSpace(cfg.Agent.BaseURL) != "" {
		// remote.go 逐字拼接 baseURL+"/v1/ask"，故在此规范化尾部斜杠（controller ruling）。
		remote := knowledge.NewRemoteAnswerer(
			strings.TrimRight(cfg.Agent.BaseURL, "/"),
			cfg.Agent.APIKey,
			cfg.Agent.Timeout,
		)
		var local knowledge.Answerer
		if !aiConfigComplete(cfg) {
			slog.Warn("no local fallback tier: AI 配置不完整，agent 故障时将无法降级到本地",
				"agent_base_url", cfg.Agent.BaseURL)
		} else if localAnswerer, buildErr := newLocalAnswerer(cfg); buildErr != nil {
			// 配置看似完整但模型构造失败：remote 档仍可独立工作，不 Fatal。
			slog.Warn("no local fallback tier: 创建 AI 模型失败，agent 故障时将无法降级到本地", "error", buildErr)
		} else {
			local = localAnswerer
		}
		if local != nil {
			answerer = knowledge.NewCompositeAnswerer(remote, local)
		} else {
			answerer = remote
		}
	} else {
		// 原 AI 必填校验与 chatModel 构造整体移入此分支。
		if !aiConfigComplete(cfg) {
			log.Fatal("AI 配置不完整：需要 ai.base_url、ai.model 和 ai.api_key（建议通过 AI_API_KEY 环境变量提供）")
		}
		local, err := newLocalAnswerer(cfg)
		if err != nil {
			log.Fatal("创建 AI 模型失败:", err)
		}
		answerer = local
	}
	knowledgeHandler := httpapi.NewKnowledgeHandler(fileService, answerer)

	uploadRepository := upload.NewGORMRepository(db)
	uploadService := upload.NewService(objectStorage, uploadRepository, folderService)
	uploadHandler := httpapi.NewUploadHandler(uploadService)

	userRepository := user.NewGORMRepository(db)
	userService := user.NewService(userRepository)
	tokenManager, err := auth.NewTokenManager(auth.TokenConfig{
		Secret:    cfg.JWT.Secret,
		Issuer:    cfg.JWT.Issuer,
		AccessTTL: cfg.JWT.AccessTTL,
	})
	if err != nil {
		log.Fatal("创建JWT管理器失败:", err)
	}

	authHandler := httpapi.NewAuthHandler(
		userService,
		tokenManager,
		auth.NewRedisLoginLimiter(redisClient),
	)

	router := httpapi.NewRouter(
		fileHandler,
		folderHandler,
		uploadHandler,
		authHandler,
		tokenManager,
		knowledgeHandler,
	)

	if err := router.Run(cfg.Server.Addr); err != nil {
		log.Fatal("启动HTTP服务失败:", err)
	}
}

// aiConfigComplete 判断本地档（eino chatModel）三项必填是否齐全；
// 调用方按所处装配分支决定缺失是 Fatal（无 remote 档）还是 Warn（Task 9）。
func aiConfigComplete(cfg config.Config) bool {
	return strings.TrimSpace(cfg.AI.BaseURL) != "" &&
		strings.TrimSpace(cfg.AI.Model) != "" &&
		strings.TrimSpace(cfg.AI.APIKey) != ""
}

// newLocalAnswerer 构造本地档；语义与原 main 内联版本逐字一致（含 120s 模型超时）。
func newLocalAnswerer(cfg config.Config) (knowledge.Answerer, error) {
	chatModel, err := openai.NewChatModel(context.Background(), &openai.ChatModelConfig{
		BaseURL: cfg.AI.BaseURL,
		Model:   cfg.AI.Model,
		APIKey:  cfg.AI.APIKey,
		Timeout: 120 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	return knowledge.NewLocalAnswerer(chatModel), nil
}
