package cache

import (
	"context"
	"sync"
)

type MemoryCache struct {
	mu        sync.RWMutex
	positions map[string][]byte
}

func NewMemoryCache() *MemoryCache {
	return &MemoryCache{
		positions: make(map[string][]byte),
	}
}

func (m *MemoryCache) SetPosition(ctx context.Context, vehicleID string, payload []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.positions[vehicleID] = payload
	return nil
}

func (m *MemoryCache) GetAllPositions(ctx context.Context) (map[string][]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Return a copy to avoid concurrent modification issues
	copyMap := make(map[string][]byte, len(m.positions))
	for k, v := range m.positions {
		copyMap[k] = v
	}
	return copyMap, nil
}

func (m *MemoryCache) Ping(ctx context.Context) error {
	return nil
}

func (m *MemoryCache) Close() error {
	return nil
}
