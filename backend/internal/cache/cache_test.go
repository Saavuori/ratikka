package cache

import (
	"context"
	"testing"
)

func TestMemoryCache_RoundTrip(t *testing.T) {
	c := NewMemoryCache()
	ctx := context.Background()

	// Ensure empty initially
	positions, err := c.GetAllPositions(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(positions) != 0 {
		t.Errorf("expected 0 positions, got %d", len(positions))
	}

	// Set a position
	vehicleID := "123"
	payload := []byte(`{"veh":123,"desi":"9"}`)
	err = c.SetPosition(ctx, vehicleID, payload)
	if err != nil {
		t.Fatalf("failed to set position: %v", err)
	}

	// Get position
	positions, err = c.GetAllPositions(ctx)
	if err != nil {
		t.Fatalf("failed to get positions: %v", err)
	}
	if len(positions) != 1 {
		t.Fatalf("expected 1 position, got %d", len(positions))
	}

	val, exists := positions[vehicleID]
	if !exists {
		t.Fatalf("expected vehicle %s to exist in positions", vehicleID)
	}
	if string(val) != string(payload) {
		t.Errorf("expected %s, got %s", string(payload), string(val))
	}
}
