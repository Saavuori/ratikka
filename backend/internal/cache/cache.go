package cache

import "context"

type Cache interface {
	SetPosition(ctx context.Context, vehicleID string, payload []byte) error
	GetAllPositions(ctx context.Context) (map[string][]byte, error)
	DeletePosition(ctx context.Context, vehicleID string) error
	Ping(ctx context.Context) error
	Close() error
}
