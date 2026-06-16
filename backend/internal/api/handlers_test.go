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
				"stoptimes": [
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

func TestConvertTripID(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"HSL:1009_20260615_Mo_2_1404", "HSL:1009_20260615_Ma_2_1404"},
		{"HSL:1003_20260615_Tu_2_1340", "HSL:1003_20260615_Ti_2_1340"},
		{"HSL:2015_20260615_We_1_1320", "HSL:2015_20260615_Ke_1_1320"},
		{"HSL:1008T_20260615_Th_1_1333", "HSL:1008T_20260615_To_1_1333"},
		{"HSL:1006_20260615_Fr_1_1342", "HSL:1006_20260615_Pe_1_1342"},
		{"HSL:1010_20260615_Sa_2_1350", "HSL:1010_20260615_La_2_1350"},
		{"HSL:1004_20260615_Su_2_1336", "HSL:1004_20260615_Su_2_1336"},
		// Tuesday 2026-06-16 should align to Monday 2026-06-15
		{"HSL:1009_20260616_Tu_1_1415", "HSL:1009_20260615_Ti_1_1415"},
		// Sunday 2026-06-21 should align to Monday 2026-06-15
		{"HSL:1009_20260621_Su_1_1415", "HSL:1009_20260615_Su_1_1415"},
	}

	for _, tc := range tests {
		got := convertTripID(tc.input)
		if got != tc.expected {
			t.Errorf("convertTripID(%q) = %q; expected %q", tc.input, got, tc.expected)
		}
	}
}

func TestParseTripIdForFuzzy(t *testing.T) {
	tests := []struct {
		input     string
		route     string
		direction int
		date      string
		timeSecs  int
		ok        bool
	}{
		{"HSL:1002_20260616_Tu_2_1653", "HSL:1002", 1, "2026-06-16", 60780, true},
		{"1009_20260615_Mo_1_0915", "HSL:1009", 0, "2026-06-15", 33300, true},
		{"invalid_trip_id", "", 0, "", 0, false},
	}

	for _, tc := range tests {
		route, dir, date, timeSecs, ok := parseTripIdForFuzzy(tc.input)
		if ok != tc.ok {
			t.Errorf("parseTripIdForFuzzy(%q) ok = %v; expected %v", tc.input, ok, tc.ok)
		}
		if ok {
			if route != tc.route {
				t.Errorf("parseTripIdForFuzzy(%q) route = %q; expected %q", tc.input, route, tc.route)
			}
			if dir != tc.direction {
				t.Errorf("parseTripIdForFuzzy(%q) direction = %d; expected %d", tc.input, dir, tc.direction)
			}
			if date != tc.date {
				t.Errorf("parseTripIdForFuzzy(%q) date = %q; expected %q", tc.input, date, tc.date)
			}
			if timeSecs != tc.timeSecs {
				t.Errorf("parseTripIdForFuzzy(%q) timeSecs = %d; expected %d", tc.input, timeSecs, tc.timeSecs)
			}
		}
	}
}


func TestHandlers_RouteDetails(t *testing.T) {
	mockGraphQLResponse := `{
		"data": {
			"routes": [
				{
					"gtfsId": "HSL:1009",
					"shortName": "9",
					"mode": "TRAM",
					"color": "007AC9",
					"patterns": [
						{
							"patternGeometry": {
								"points": "polyline_points_9"
							}
						}
					]
				}
			]
		}
	}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(mockGraphQLResponse))
	}))
	defer ts.Close()

	oldEndpoint := DigitransitURLEndpoint
	DigitransitURLEndpoint = ts.URL
	defer func() { DigitransitURLEndpoint = oldEndpoint }()

	memCache := cache.NewMemoryCache()
	mqtt := &mockMqttWorker{connected: true}
	gql := NewGraphQLClient("test-api-key")
	handlers := NewHandlers(memCache, gql, mqtt)

	req := httptest.NewRequest("GET", "/api/v1/route/9", nil)
	req.SetPathValue("shortName", "9")

	rr := httptest.NewRecorder()
	handlers.RouteDetails(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	var resp RouteDetailsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.ShortName != "9" {
		t.Errorf("expected shortName 9, got %s", resp.ShortName)
	}
	if len(resp.Geometries) != 1 || resp.Geometries[0] != "polyline_points_9" {
		t.Errorf("unexpected geometries: %v", resp.Geometries)
	}
}

func TestHandlers_BikeStationDetails(t *testing.T) {
	mockGraphQLResponse := `{
		"data": {
			"vehicleRentalStation": {
				"stationId": "smoove:625",
				"name": "Suomenlahdentie",
				"allowPickup": true,
				"allowDropoff": true,
				"availableVehicles": {
					"byType": [
						{
							"count": 21,
							"vehicleType": {
								"formFactor": "BICYCLE"
							}
						}
					]
				},
				"availableSpaces": {
					"byType": [
						{
							"count": 5,
							"vehicleType": {
								"formFactor": "BICYCLE"
							}
						}
					]
				}
			}
		}
	}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(mockGraphQLResponse))
	}))
	defer ts.Close()

	oldEndpoint := DigitransitURLEndpoint
	DigitransitURLEndpoint = ts.URL
	defer func() { DigitransitURLEndpoint = oldEndpoint }()

	memCache := cache.NewMemoryCache()
	mqtt := &mockMqttWorker{connected: true}
	gql := NewGraphQLClient("test-api-key")
	handlers := NewHandlers(memCache, gql, mqtt)

	req := httptest.NewRequest("GET", "/api/v1/bike-station/smoove:625", nil)
	req.SetPathValue("stationId", "smoove:625")

	rr := httptest.NewRecorder()
	handlers.BikeStationDetails(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	var resp BikeStationDetailsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.StationId != "smoove:625" {
		t.Errorf("expected stationId smoove:625, got %s", resp.StationId)
	}
	if resp.Name != "Suomenlahdentie" {
		t.Errorf("expected name Suomenlahdentie, got %s", resp.Name)
	}
	if !resp.AllowPickup {
		t.Error("expected AllowPickup true")
	}
	if !resp.AllowDropoff {
		t.Error("expected AllowDropoff true")
	}
	if resp.BikesAvailable != 21 {
		t.Errorf("expected BikesAvailable 21, got %d", resp.BikesAvailable)
	}
	if resp.SpacesAvailable != 5 {
		t.Errorf("expected SpacesAvailable 5, got %d", resp.SpacesAvailable)
	}
}

