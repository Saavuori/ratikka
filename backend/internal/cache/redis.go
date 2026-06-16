package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const RedisKey = "ratikka:positions"

type RedisCache struct {
	client *redis.Client
}

func NewRedisCache(redisURL string) (*RedisCache, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse redis URL: %w", err)
	}

	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to ping redis: %w", err)
	}

	return &RedisCache{client: client}, nil
}

func (r *RedisCache) SetPosition(ctx context.Context, vehicleID string, payload []byte) error {
	return r.client.HSet(ctx, RedisKey, vehicleID, payload).Err()
}

func (r *RedisCache) GetAllPositions(ctx context.Context) (map[string][]byte, error) {
	results, err := r.client.HGetAll(ctx, RedisKey).Result()
	if err != nil {
		return nil, err
	}

	positions := make(map[string][]byte, len(results))
	for k, v := range results {
		positions[k] = []byte(v)
	}
	return positions, nil
}

func (r *RedisCache) DeletePosition(ctx context.Context, vehicleID string) error {
	return r.client.HDel(ctx, RedisKey, vehicleID).Err()
}

func (r *RedisCache) Ping(ctx context.Context) error {
	return r.client.Ping(ctx).Err()
}

func (r *RedisCache) Close() error {
	return r.client.Close()
}
