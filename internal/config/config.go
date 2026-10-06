package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/spf13/viper"
)

type Config struct {
	Server ServerConfig `mapstructure:"server"`
	MySQL  MySQLConfig  `mapstructure:"mysql"`
	Redis  RedisConfig  `mapstructure:"redis"`
	MinIO  MinIOConfig  `mapstructure:"minio"`
	JWT    JWTConfig    `mapstructure:"jwt"`
	AI     AIConfig     `mapstructure:"ai"`
}

type ServerConfig struct {
	Addr string `mapstructure:"addr"`
}

type MySQLConfig struct {
	// DSN is an optional compatibility override for existing local deployments.
	DSN             string        `mapstructure:"dsn"`
	Host            string        `mapstructure:"host"`
	Port            int           `mapstructure:"port"`
	User            string        `mapstructure:"user"`
	Password        string        `mapstructure:"password"`
	Database        string        `mapstructure:"database"`
	MaxOpenConns    int           `mapstructure:"max_open_conns"`
	MaxIdleConns    int           `mapstructure:"max_idle_conns"`
	ConnMaxIdleTime time.Duration `mapstructure:"conn_max_idle_time"`
}

// ConnectionString generates a safe DSN from structured fields unless the
// existing MYSQL_DSN override is present.
func (c MySQLConfig) ConnectionString() string {
	if strings.TrimSpace(c.DSN) != "" {
		return c.DSN
	}
	dsn := mysqldriver.NewConfig()
	dsn.User = c.User
	dsn.Passwd = c.Password
	dsn.Net = "tcp"
	dsn.Addr = net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
	dsn.DBName = c.Database
	dsn.ParseTime = true
	dsn.Loc = time.Local
	return dsn.FormatDSN()
}

type MinIOConfig struct {
	Endpoint  string `mapstructure:"endpoint"`
	AccessKey string `mapstructure:"access_key"`
	SecretKey string `mapstructure:"secret_key"`
	Bucket    string `mapstructure:"bucket"`
	UseSSL    bool   `mapstructure:"use_ssl"`
}

type RedisConfig struct {
	Addr     string `mapstructure:"addr"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

type JWTConfig struct {
	Secret    string        `mapstructure:"secret"`
	Issuer    string        `mapstructure:"issuer"`
	AccessTTL time.Duration `mapstructure:"access_ttl"`
}

type AIConfig struct {
	BaseURL string `mapstructure:"base_url"`
	Model   string `mapstructure:"model"`
	APIKey  string `mapstructure:"api_key"`
}

// Load 读取非敏感 YAML，并允许环境变量覆盖或提供敏感配置。
func Load() (Config, error) {
	v := viper.New()
	configFile := os.Getenv("CONFIG_FILE")
	if configFile == "" {
		configFile = "config.yaml"
	}
	v.SetConfigFile(configFile)

	bindings := map[string]string{
		"server.addr":              "APP_ADDR",
		"mysql.dsn":                "MYSQL_DSN",
		"mysql.host":               "MYSQL_HOST",
		"mysql.port":               "MYSQL_PORT",
		"mysql.user":               "MYSQL_USER",
		"mysql.password":           "MYSQL_PASSWORD",
		"mysql.database":           "MYSQL_DATABASE",
		"mysql.max_open_conns":     "MYSQL_MAX_OPEN_CONNS",
		"mysql.max_idle_conns":     "MYSQL_MAX_IDLE_CONNS",
		"mysql.conn_max_idle_time": "MYSQL_CONN_MAX_IDLE_TIME",
		"redis.addr":               "REDIS_ADDR",
		"redis.password":           "REDIS_PASSWORD",
		"redis.db":                 "REDIS_DB",
		"minio.endpoint":           "MINIO_ENDPOINT",
		"minio.access_key":         "MINIO_ACCESS_KEY",
		"minio.secret_key":         "MINIO_SECRET_KEY",
		"minio.bucket":             "MINIO_BUCKET",
		"minio.use_ssl":            "MINIO_USE_SSL",
		"jwt.secret":               "JWT_SECRET",
		"jwt.issuer":               "JWT_ISSUER",
		"jwt.access_ttl":           "JWT_ACCESS_TTL",
		"ai.api_key":               "AI_API_KEY",
	}
	for key, env := range bindings {
		if err := v.BindEnv(key, env); err != nil {
			return Config{}, fmt.Errorf("bind environment variable %s: %w", env, err)
		}
	}

	if err := v.ReadInConfig(); err != nil {
		return Config{}, fmt.Errorf("read config file %s: %w", configFile, err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) validate() error {
	switch {
	case strings.TrimSpace(c.Server.Addr) == "":
		return errors.New("server.addr is required")
	case c.MySQL.MaxOpenConns <= 0:
		return errors.New("mysql.max_open_conns must be positive")
	case c.MySQL.MaxIdleConns < 0 || c.MySQL.MaxIdleConns > c.MySQL.MaxOpenConns:
		return errors.New("mysql.max_idle_conns must be between 0 and max_open_conns")
	case c.MySQL.ConnMaxIdleTime <= 0:
		return errors.New("mysql.conn_max_idle_time must be positive")
	case strings.TrimSpace(c.MySQL.DSN) == "" && strings.TrimSpace(c.MySQL.Host) == "":
		return errors.New("mysql.host is required when MYSQL_DSN is not set")
	case strings.TrimSpace(c.MySQL.DSN) == "" && (c.MySQL.Port < 1 || c.MySQL.Port > 65535):
		return errors.New("mysql.port must be between 1 and 65535")
	case strings.TrimSpace(c.MySQL.DSN) == "" && strings.TrimSpace(c.MySQL.User) == "":
		return errors.New("mysql.user is required when MYSQL_DSN is not set")
	case strings.TrimSpace(c.MySQL.DSN) == "" && strings.TrimSpace(c.MySQL.Password) == "":
		return errors.New("MYSQL_PASSWORD is required when MYSQL_DSN is not set")
	case strings.TrimSpace(c.MySQL.DSN) == "" && strings.TrimSpace(c.MySQL.Database) == "":
		return errors.New("mysql.database is required when MYSQL_DSN is not set")
	case strings.TrimSpace(c.Redis.Addr) == "":
		return errors.New("redis.addr is required")
	case c.Redis.DB < 0:
		return errors.New("redis.db must be non-negative")
	case strings.TrimSpace(c.MinIO.Endpoint) == "":
		return errors.New("MINIO_ENDPOINT is required")
	case strings.TrimSpace(c.MinIO.AccessKey) == "":
		return errors.New("MINIO_ACCESS_KEY is required")
	case strings.TrimSpace(c.MinIO.SecretKey) == "":
		return errors.New("MINIO_SECRET_KEY is required")
	case strings.TrimSpace(c.MinIO.Bucket) == "":
		return errors.New("minio.bucket is required")
	case len([]byte(c.JWT.Secret)) < 32:
		return errors.New("JWT_SECRET must contain at least 32 bytes")
	case strings.TrimSpace(c.JWT.Issuer) == "":
		return errors.New("jwt.issuer is required")
	case c.JWT.AccessTTL <= 0:
		return errors.New("jwt.access_ttl must be positive")
	}
	return nil
}
