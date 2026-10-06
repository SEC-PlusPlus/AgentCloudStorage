package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"PersonalCloudStorage/internal/config"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/schema"
	"github.com/spf13/viper"
)

func main() {
	v := viper.New()
	configFile := os.Getenv("CONFIG_FILE")
	if configFile == "" {
		configFile = "config.yaml"
	}
	v.SetConfigFile(configFile)
	if err := v.BindEnv("ai.api_key", "AI_API_KEY"); err != nil {
		log.Fatalf("bind AI_API_KEY: %v", err)
	}
	if err := v.ReadInConfig(); err != nil {
		log.Fatalf("read config file: %v", err)
	}
	var cfg config.AIConfig
	err := v.UnmarshalKey("ai", &cfg)
	if err != nil {
		log.Fatalf("decode ai config: %v", err)
	}
	if strings.TrimSpace(cfg.BaseURL) == "" || strings.TrimSpace(cfg.Model) == "" {
		log.Fatal("ai.base_url and ai.model are required")
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		log.Fatal("AI_API_KEY is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	chatModel, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
		BaseURL: cfg.BaseURL,
		Model:   cfg.Model,
		APIKey:  cfg.APIKey,
		Timeout: 120 * time.Second,
	})
	if err != nil {
		log.Fatalf("create chat model: %v", err)
	}

	reply, err := chatModel.Generate(ctx, []*schema.Message{
		{Role: schema.User, Content: "请用一句中文简短回复：模型连接成功。"},
	})
	if err != nil {
		log.Fatalf("call chat model: %v", err)
	}
	if reply == nil || strings.TrimSpace(reply.Content) == "" {
		log.Fatal("model returned no answer content")
	}
	fmt.Println(reply.Content)
}
