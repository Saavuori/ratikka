package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ratikka/internal/cache"
)

type mockMqttWorker struct {
	connected bool
}

func (m *mockMqttWorker) IsConnected() bool {
	return m.connected
}

func TestHandlers_Health(t *testing.T) {
	memCache := cache.NewMemoryCache()
	mqtt := &mockMqttWorker{connected: true}
	gql := NewGraphQLClient("")
	handlers := NewHandlers(memCache, gql, mqtt)

	// Set a mock vehicle position in cache
	memCache.SetPosition(context.Background(), "229", []byte(`{"veh":229}`))

	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	rr := httptest.NewRecorder()

	handlers.Health(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}

	var resp HealthResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Status != "healthy" {
		t.Errorf("expected status healthy, got %s", resp.Status)
	}
	if !resp.MQTTConnected {
		t.Error("expected MQTTConnected true")
	}
	if !resp.RedisConnected {
		t.Error("expected RedisConnected true (MemoryCache behaves as connected)")
	}
	if resp.ActiveVehicles != 1 {
		t.Errorf("expected active vehicles 1, got %d", resp.ActiveVehicles)
	}
}

func TestHandlers_Version(t *testing.T) {
	Version = "v1.2.3"
	BuildDate = "2026-06-15"
	GitCommit = "abc123f"

	memCache := cache.NewMemoryCache()
	mqtt := &mockMqttWorker{connected: true}
	gql := NewGraphQLClient("")
	handlers := NewHandlers(memCache, gql, mqtt)

	req := httptest.NewRequest("GET", "/api/v1/version", nil)
	rr := httptest.NewRecorder()

	handlers.Version(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}

	var resp VersionResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Version != "v1.2.3" {
		t.Errorf("expected version v1.2.3, got %s", resp.Version)
	}
	if resp.BuildDate != "2026-06-15" {
		t.Errorf("expected build date 2026-06-15, got %s", resp.BuildDate)
	}
	if resp.GitCommit != "abc123f" {
		t.Errorf("expected git commit abc123f, got %s", resp.GitCommit)
	}
}

func TestHandlers_TripDetails(t *testing.T) {
	// Setup mock GraphQL server
	mockGraphQLResponse := `{
		"data": {
			"trip": {
				"gtfsId": "HSL:1009_20260615_Su_1_0915",
				"route": {
					"shortName": "9",
					"longName": "Pasila - Jätkäsaari",
					"mode": "TRAM",
					"color": "007AC9"
				},
				"tripHeadsign": "Jätkäsaari",
				"stoptimesForTrip": [
					{
						"scheduledArrival": 33480,
						"realtimeArrival": 33420,
						"arrivalDelay": -60,
						"scheduledDeparture": 33480,
						"realtimeDeparture": 33420,
						"departureDelay": -60,
						"realtime": true,
						"realtimeState": "UPDATED",
						"stop": {
							"gtfsId": "HSL:1203420",
							"name": "Välimerenkatu",
							"code": "0613",
							"lat": 60.1629,
							"lon": 24.9213
						}
					}
				],
				"tripGeometry": {
					"length": 1200,
					"points": "polyline_points"
				}
			}
		}
	}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(mockGraphQLResponse))
	}))
	defer ts.Close()

	// Override URL
	oldEndpoint := DigitransitURLEndpoint
	DigitransitURLEndpoint = ts.URL
	defer func() { DigitransitURLEndpoint = oldEndpoint }()

	memCache := cache.NewMemoryCache()
	mqtt := &mockMqttWorker{connected: true}
	gql := NewGraphQLClient("test-api-key")
	handlers := NewHandlers(memCache, gql, mqtt)

	// Create test request for /api/v1/trip/{tripId}
	req := httptest.NewRequest("GET", "/api/v1/trip/HSL:1009_20260615_Su_1_0915", nil)
	// In Go 1.22 we set PathValue manually for testing routing
	req.SetPathValue("tripId", "HSL:1009_20260615_Su_1_0915")

	rr := httptest.NewRecorder()

	handlers.TripDetails(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	var resp TripDetailsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.TripId != "HSL:1009_20260615_Su_1_0915" {
		t.Errorf("expected tripId, got %s", resp.TripId)
	}
	if resp.Route.ShortName != "9" {
		t.Errorf("expected route shortName 9, got %s", resp.Route.ShortName)
	}
	if resp.Route.Color != "007AC9" {
		t.Errorf("expected route color 007AC9, got %s", resp.Route.Color)
	}
	if resp.Geometry != "polyline_points" {
		t.Errorf("expected geometry, got %s", resp.Geometry)
	}

	if len(resp.Stops) != 1 {
		t.Fatalf("expected 1 stop, got %d", len(resp.Stops))
	}
	stop := resp.Stops[0]
	if stop.Name != "Välimerenkatu" {
		t.Errorf("expected stop name, got %s", stop.Name)
	}
	// 33480 seconds from midnight is 09:18
	if stop.ScheduledArrival != "09:18" {
		t.Errorf("expected scheduled arrival 09:18, got %s", stop.ScheduledArrival)
	}
	// 33420 seconds is 09:17
	if stop.RealtimeArrival != "09:17" {
		t.Errorf("expected realtime arrival 09:17, got %s", stop.RealtimeArrival)
	}
	if stop.Delay != -60 {
		t.Errorf("expected delay -60, got %d", stop.Delay)
	}
	if !stop.Realtime {
		t.Error("expected realtime true")
	}
}

func TestHandlers_StopDetails(t *testing.T) {
	// Setup mock GraphQL server
	mockGraphQLResponse := `{
		"data": {
			"stop": {
				"gtfsId": "HSL:1203420",
				"name": "Välimerenkatu",
				"code": "0613",
				"lat": 60.1629,
				"lon": 24.9213,
				"routes": [
					{"shortName": "9", "longName": "Line 9", "mode": "TRAM"},
					{"shortName": "7", "longName": "Line 7", "mode": "TRAM"},
					{"shortName": "9", "longName": "Line 9 Duplicate", "mode": "TRAM"}
				],
				"stoptimesWithoutPatterns": [
					{
						"scheduledArrival": 33900,
						"realtimeArrival": 33840,
						"arrivalDelay": -60,
						"realtime": true,
						"realtimeState": "UPDATED",
						"headsign": "Pasila",
						"trip": {
							"gtfsId": "HSL:1009_20260615_Su_2_0910",
							"route": {
								"shortName": "9",
								"color": "007AC9"
							}
						}
					}
				]
			}
		}
	}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(mockGraphQLResponse))
	}))
	defer ts.Close()

	// Override URL
	oldEndpoint := DigitransitURLEndpoint
	DigitransitURLEndpoint = ts.URL
	defer func() { DigitransitURLEndpoint = oldEndpoint }()

	memCache := cache.NewMemoryCache()
	mqtt := &mockMqttWorker{connected: true}
	gql := NewGraphQLClient("test-api-key")
	handlers := NewHandlers(memCache, gql, mqtt)

	// Create test request for /api/v1/stop/{stopId}
	req := httptest.NewRequest("GET", "/api/v1/stop/HSL:1203420", nil)
	req.SetPathValue("stopId", "HSL:1203420")

	rr := httptest.NewRecorder()

	handlers.StopDetails(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	var resp StopDetailsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Stop.GtfsId != "HSL:1203420" {
		t.Errorf("expected stop id, got %s", resp.Stop.GtfsId)
	}
	if resp.Stop.Name != "Välimerenkatu" {
		t.Errorf("expected stop name, got %s", resp.Stop.Name)
	}

	// Verify routes are unique (duplicates filtered out)
	if len(resp.Routes) != 2 {
		t.Fatalf("expected 2 unique routes, got %d (%v)", len(resp.Routes), resp.Routes)
	}
	if (resp.Routes[0] != "9" && resp.Routes[0] != "7") || (resp.Routes[1] != "9" && resp.Routes[1] != "7") {
		t.Errorf("unexpected routes list: %v", resp.Routes)
	}

	if len(resp.Departures) != 1 {
		t.Fatalf("expected 1 departure, got %d", len(resp.Departures))
	}
	dep := resp.Departures[0]
	if dep.Line != "9" {
		t.Errorf("expected line 9, got %s", dep.Line)
	}
	if dep.Headsign != "Pasila" {
		t.Errorf("expected headsign Pasila, got %s", dep.Headsign)
	}
	// 33900 seconds from midnight is 09:25
	if dep.ScheduledArrival != "09:25" {
		t.Errorf("expected scheduled arrival 09:25, got %s", dep.ScheduledArrival)
	}
	// 33840 seconds is 09:24
	if dep.RealtimeArrival != "09:24" {
		t.Errorf("expected realtime arrival 09:24, got %s", dep.RealtimeArrival)
	}
	if dep.Delay != -60 {
		t.Errorf("expected delay -60, got %d", dep.Delay)
	}
	if !dep.Realtime {
		t.Error("expected realtime true")
	}
	if dep.TripId != "HSL:1009_20260615_Su_2_0910" {
		t.Errorf("expected tripId, got %s", dep.TripId)
	}
}
