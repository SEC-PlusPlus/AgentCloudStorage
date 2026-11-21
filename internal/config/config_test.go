package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"
)

func testConfigFile(t *testing.T) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	data := []byte("server:\n  addr: ':8080'\nmysql:\n  host: 127.0.0.1\n  port: 3307\n  user: govault\n  database: govault\n  max_open_conns: 20\n  max_idle_conns: 10\n  conn_max_idle_time: 30m\nredis:\n  addr: 127.0.0.1:6380\n  db: 0\nminio:\n  endpoint: 127.0.0.1:9000\n  bucket: govault\n  use_ssl: false\njwt:\n  issuer: govault\n  access_ttl: 2h\n")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CONFIG_FILE", path)
}

func TestLoadMergesYAMLAndEnvironment(t *testing.T) {
	testConfigFile(t)
	t.Setenv("MYSQL_DSN", "test-dsn")
	t.Setenv("MINIO_ENDPOINT", "127.0.0.1:9000")
	t.Setenv("MINIO_ACCESS_KEY", "test-access")
	t.Setenv("MINIO_SECRET_KEY", "test-secret")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	t.Setenv("APP_ADDR", ":9090")
	t.Setenv("REDIS_ADDR", "127.0.0.1:6381")
	t.Setenv("MINIO_USE_SSL", "true")
	t.Setenv("JWT_ACCESS_TTL", "3h")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Addr != ":9090" || cfg.MySQL.DSN != "test-dsn" {
		t.Fatalf("environment values not loaded: addr=%q dsn=%q", cfg.Server.Addr, cfg.MySQL.DSN)
	}
	if cfg.MySQL.ConnectionString() != "test-dsn" || cfg.MySQL.MaxOpenConns != 20 || cfg.MySQL.ConnMaxIdleTime != 30*time.Minute {
		t.Fatal("MySQL DSN override or pool settings not loaded")
	}
	if cfg.Redis.Addr != "127.0.0.1:6381" || cfg.Redis.DB != 0 {
		t.Fatalf("Redis values not loaded: addr=%q db=%d", cfg.Redis.Addr, cfg.Redis.DB)
	}
	if cfg.MinIO.Bucket != "govault" || !cfg.MinIO.UseSSL {
		t.Fatalf("YAML and environment values not merged: bucket=%q ssl=%v", cfg.MinIO.Bucket, cfg.MinIO.UseSSL)
	}
	if cfg.JWT.Issuer != "govault" || cfg.JWT.AccessTTL != 3*time.Hour {
		t.Fatalf("JWT values not loaded: issuer=%q ttl=%s", cfg.JWT.Issuer, cfg.JWT.AccessTTL)
	}
}

func TestLoadStructuredMySQL(t *testing.T) {
	testConfigFile(t)
	t.Setenv("MYSQL_DSN", "")
	t.Setenv("MYSQL_PASSWORD", "test-password")
	t.Setenv("MYSQL_PORT", "3308")
	t.Setenv("MINIO_ACCESS_KEY", "test-access")
	t.Setenv("MINIO_SECRET_KEY", "test-secret")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	dsn, err := mysqldriver.ParseDSN(cfg.MySQL.ConnectionString())
	if err != nil {
		t.Fatal(err)
	}
	if dsn.Addr != "127.0.0.1:3308" || dsn.User != "govault" || dsn.Passwd != "test-password" || dsn.DBName != "govault" || !dsn.ParseTime {
		t.Fatal("structured MySQL settings did not produce the expected DSN")
	}
}

func TestLoadRejectsMissingSecret(t *testing.T) {
	testConfigFile(t)
	t.Setenv("MYSQL_DSN", "test-dsn")
	t.Setenv("MINIO_ENDPOINT", "127.0.0.1:9000")
	t.Setenv("MINIO_ACCESS_KEY", "test-access")
	t.Setenv("MINIO_SECRET_KEY", "test-secret")
	t.Setenv("JWT_SECRET", "")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Fatalf("expected JWT_SECRET validation error, got %v", err)
	}
}

func setRequiredSecrets(t *testing.T) {
	t.Helper()
	t.Setenv("MYSQL_DSN", "test-dsn")
	t.Setenv("MINIO_ACCESS_KEY", "test-access")
	t.Setenv("MINIO_SECRET_KEY", "test-secret")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
}

func TestAgentTimeoutDefault(t *testing.T) {
	testConfigFile(t)
	setRequiredSecrets(t)

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	// 默认 60s 必须 > agent 侧 llm_timeout 45s，见 Review Focus 1。
	if cfg.Agent.Timeout != 60*time.Second {
		t.Fatalf("expected agent timeout default 60s, got %s", cfg.Agent.Timeout)
	}
}

func TestAgentRequiresKeyWhenBaseURLSet(t *testing.T) {
	testConfigFile(t)
	setRequiredSecrets(t)
	t.Setenv("AGENT_BASE_URL", "http://127.0.0.1:8000")
	t.Setenv("AGENT_API_KEY", "")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "agent.api_key is required when agent.base_url is set") {
		t.Fatalf("expected agent.api_key validation error, got %v", err)
	}
}

func TestAgentRejectsNegativeTimeout(t *testing.T) {
	testConfigFile(t)
	setRequiredSecrets(t)
	t.Setenv("AGENT_TIMEOUT", "-1s")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "agent.timeout must be positive") {
		t.Fatalf("expected agent.timeout validation error, got %v", err)
	}
}

func TestAgentEnvOverrides(t *testing.T) {
	testConfigFile(t)
	setRequiredSecrets(t)
	t.Setenv("AGENT_BASE_URL", "http://127.0.0.1:8000")
	t.Setenv("AGENT_API_KEY", "agent-key")
	t.Setenv("AGENT_TIMEOUT", "90s")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Agent.BaseURL != "http://127.0.0.1:8000" || cfg.Agent.APIKey != "agent-key" || cfg.Agent.Timeout != 90*time.Second {
		t.Fatalf("agent environment values not loaded: base_url=%q api_key=%q timeout=%s",
			cfg.Agent.BaseURL, cfg.Agent.APIKey, cfg.Agent.Timeout)
	}
}
