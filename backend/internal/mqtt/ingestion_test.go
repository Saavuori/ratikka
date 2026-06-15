package mqtt

import (
	"context"
	"encoding/json"
	"testing"

	"ratikka/internal/cache"
)

type mockMessage struct {
	payload []byte
	topic   string
}

func (m *mockMessage) Duplicate() bool   { return false }
func (m *mockMessage) Qos() byte         { return 0 }
func (m *mockMessage) Retained() bool    { return false }
func (m *mockMessage) Topic() string     { return m.topic }
func (m *mockMessage) MessageID() uint16 { return 0 }
func (m *mockMessage) Payload() []byte   { return m.payload }
func (m *mockMessage) Ack()              {}

func TestIngestionWorker_HandleMessage(t *testing.T) {
	memCache := cache.NewMemoryCache()
	worker := NewIngestionWorker("tls://mock:8883", memCache)

	rawPayload := `{
		"VP": {
			"desi": "9",
			"dir": "1",
			"oper": 22,
			"veh": 229,
			"tst": "2026-06-15T09:30:15.123Z",
			"tsi": 1781461815,
			"spd": 8.5,
			"hdg": 145,
			"lat": 60.16985,
			"long": 24.93848,
			"acc": 0.12,
			"dl": -15,
			"odo": 12456,
			"drst": 0,
			"oday": "2026-06-15",
			"jrn": 456,
			"line": 312,
			"start": "09:15",
			"loc": "GPS",
			"stop": "HSL:1203420",
			"route": "HSL:1009",
			"occu": 0
		}
	}`

	msg := &mockMessage{
		payload: []byte(rawPayload),
		topic:   "/hfp/v2/journey/ongoing/vp/tram/22/229/HSL:1009/1/Jätkäsaari/09:15/HSL:1203420/14/60.17/24.94",
	}

	worker.handleMessage(nil, msg)

	// Fetch from cache and check
	ctx := context.Background()
	positions, err := memCache.GetAllPositions(ctx)
	if err != nil {
		t.Fatalf("unexpected error fetching from cache: %v", err)
	}

	if len(positions) != 1 {
		t.Fatalf("expected 1 position in cache, got %d", len(positions))
	}

	cachedBytes, exists := positions["229"]
	if !exists {
		t.Fatal("expected vehicle 229 to be cached")
	}

	var thinned VehiclePosition
	if err := json.Unmarshal(cachedBytes, &thinned); err != nil {
		t.Fatalf("failed to unmarshal cached bytes: %v", err)
	}

	// Verify thinned fields match
	if thinned.Veh != 229 {
		t.Errorf("expected Veh 229, got %d", thinned.Veh)
	}
	if thinned.Desi != "9" {
		t.Errorf("expected Desi 9, got %q", thinned.Desi)
	}
	if thinned.Lat != 60.16985 {
		t.Errorf("expected Lat 60.16985, got %f", thinned.Lat)
	}
	if thinned.Lng != 24.93848 {
		t.Errorf("expected Lng 24.93848, got %f", thinned.Lng)
	}
	if thinned.Hdg != 145 {
		t.Errorf("expected Hdg 145, got %d", thinned.Hdg)
	}
	if thinned.Spd != 8.5 {
		t.Errorf("expected Spd 8.5, got %f", thinned.Spd)
	}
	if thinned.Dl != -15 {
		t.Errorf("expected Dl -15, got %d", thinned.Dl)
	}
	if thinned.Drst != 0 {
		t.Errorf("expected Drst 0, got %d", thinned.Drst)
	}
	if thinned.Route != "HSL:1009" {
		t.Errorf("expected Route HSL:1009, got %q", thinned.Route)
	}
	if thinned.Stop == nil || *thinned.Stop != "HSL:1203420" {
		t.Errorf("expected Stop HSL:1203420, got %v", thinned.Stop)
	}
	if thinned.Ts != 1781461815 {
		t.Errorf("expected Ts 1781461815, got %d", thinned.Ts)
	}
	if thinned.TripId != "HSL:1009_20260615_Mo_1_0915" {
		t.Errorf("expected TripId HSL:1009_20260615_Mo_1_0915, got %q", thinned.TripId)
	}
}

func TestIngestionWorker_HandleMessage_Invalid(t *testing.T) {
	memCache := cache.NewMemoryCache()
	worker := NewIngestionWorker("tls://mock:8883", memCache)

	// Test invalid JSON
	msgInvalid := &mockMessage{
		payload: []byte(`{invalid-json}`),
	}
	worker.handleMessage(nil, msgInvalid)

	positions, _ := memCache.GetAllPositions(context.Background())
	if len(positions) != 0 {
		t.Errorf("expected cache to be empty for invalid payload, got %d", len(positions))
	}

	// Test zero coordinates
	zeroCoords := `{
		"VP": {
			"veh": 229,
			"lat": 0,
			"long": 0
		}
	}`
	msgZero := &mockMessage{
		payload: []byte(zeroCoords),
	}
	worker.handleMessage(nil, msgZero)

	positions, _ = memCache.GetAllPositions(context.Background())
	if len(positions) != 0 {
		t.Errorf("expected cache to be empty for zero coordinates, got %d", len(positions))
	}
}

func TestIngestionWorker_HandleMessage_StopNormalization(t *testing.T) {
	tests := []struct {
		name         string
		stopInput    interface{}
		expectedStop string
	}{
		{
			name:         "Number stop ID",
			stopInput:    1020448,
			expectedStop: "HSL:1020448",
		},
		{
			name:         "String stop ID without prefix",
			stopInput:    "1020448",
			expectedStop: "HSL:1020448",
		},
		{
			name:         "String stop ID with prefix",
			stopInput:    "HSL:1020448",
			expectedStop: "HSL:1020448",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			memCache := cache.NewMemoryCache()
			worker := NewIngestionWorker("tls://mock:8883", memCache)

			vpData := map[string]interface{}{
				"VP": map[string]interface{}{
					"veh":  229,
					"desi": "9",
					"lat":  60.16985,
					"long": 24.93848,
					"stop": tt.stopInput,
				},
			}

			payloadBytes, err := json.Marshal(vpData)
			if err != nil {
				t.Fatalf("failed to marshal test payload: %v", err)
			}

			msg := &mockMessage{
				payload: payloadBytes,
				topic:   "test",
			}

			worker.handleMessage(nil, msg)

			positions, err := memCache.GetAllPositions(context.Background())
			if err != nil {
				t.Fatalf("failed to get positions: %v", err)
			}

			cachedBytes, exists := positions["229"]
			if !exists {
				t.Fatal("expected vehicle 229 in cache")
			}

			var thinned VehiclePosition
			if err := json.Unmarshal(cachedBytes, &thinned); err != nil {
				t.Fatalf("failed to unmarshal cached vehicle: %v", err)
			}

			if thinned.Stop == nil {
				t.Fatal("expected stop to be non-nil")
			}

			if *thinned.Stop != tt.expectedStop {
				t.Errorf("expected stop %q, got %q", tt.expectedStop, *thinned.Stop)
			}
		})
	}
}

