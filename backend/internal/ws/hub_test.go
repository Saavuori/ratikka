package ws

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"ratikka/internal/cache"
)

func TestHub_RegisterAndBroadcast(t *testing.T) {
	memCache := cache.NewMemoryCache()
	hub := NewHub(memCache)

	// Add dummy vehicle in cache
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	payload := []byte(`{"veh":229,"desi":"9","lat":60.1,"lng":24.9,"hdg":180,"spd":5.5,"dl":0,"drst":0,"route":"HSL:1009","stop":null,"ts":1781461815}`)
	memCache.SetPosition(ctx, "229", payload)

	// Start hub Run loop in background
	go hub.Run(ctx)

	// Register a mock client
	client := &Client{
		conn: nil,
		send: make(chan []byte, 10),
	}

	hub.register <- client

	// Let the register process
	time.Sleep(100 * time.Millisecond)

	// Force a broadcast manually
	hub.broadcastSnapshot(ctx)

	// Check if client received the message
	select {
	case msgBytes, ok := <-client.send:
		if !ok {
			t.Fatal("client send channel was closed")
		}

		var msg PositionsMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			t.Fatalf("failed to unmarshal broadcast message: %v", err)
		}

		if msg.Type != "positions" {
			t.Errorf("expected msg type 'positions', got %q", msg.Type)
		}
		if msg.Count != 1 {
			t.Errorf("expected count 1, got %d", msg.Count)
		}
		cachedVal, exists := msg.Vehicles["229"]
		if !exists {
			t.Fatal("expected vehicle 229 in broadcast message")
		}

		var veh map[string]interface{}
		if err := json.Unmarshal(cachedVal, &veh); err != nil {
			t.Fatalf("failed to parse vehicle json: %v", err)
		}
		if veh["desi"] != "9" {
			t.Errorf("expected desi '9', got %v", veh["desi"])
		}

	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for client to receive broadcast")
	}

	// Test unregister
	hub.unregister <- client

	// Verify client send is closed
	select {
	case _, ok := <-client.send:
		if ok {
			t.Error("expected client send channel to be closed after unregister")
		}
	case <-time.After(1 * time.Second):
		t.Error("timed out waiting for client channel closure")
	}
}
