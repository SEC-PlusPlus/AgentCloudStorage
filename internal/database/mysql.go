package database

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func OpenMySQL(dsn string) (*gorm.DB, error) {
	return OpenMySQLWithPool(dsn, PoolConfig{
		MaxOpenConns:    20,
		MaxIdleConns:    10,
		ConnMaxIdleTime: 30 * time.Minute,
	})
}

type PoolConfig struct {
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxIdleTime time.Duration
}

func OpenMySQLWithPool(dsn string, pool PoolConfig) (*gorm.DB, error) {
	if strings.TrimSpace(dsn) == "" {
		return nil, errors.New("mysql dsn is required")
	}
	if pool.MaxOpenConns <= 0 || pool.MaxIdleConns < 0 || pool.MaxIdleConns > pool.MaxOpenConns || pool.ConnMaxIdleTime <= 0 {
		return nil, errors.New("invalid mysql connection pool configuration")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		TranslateError: true})
	if err != nil {
		return nil, fmt.Errorf("open mysql with gorm: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get underlying sql db:%w", err)
	}
	sqlDB.SetMaxOpenConns(pool.MaxOpenConns)
	sqlDB.SetMaxIdleConns(pool.MaxIdleConns)
	sqlDB.SetConnMaxIdleTime(pool.ConnMaxIdleTime)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping mysql : %w", err)
	}
	return db, nil
}
