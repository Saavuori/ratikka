package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ratikka/internal/cache"
)

func TestHandlers_Geocode(t *testing.T) {
	mockResponse := `{
		"features": [
			{
				"geometry": { "type": "Point", "coordinates": [24.9310, 60.1690] },
				"properties": {
					"id": "node:1",
					"gid": "openstreetmap:venue:node:1",
					"name": "Kamppi",
					"label": "Kamppi, Helsinki",
					"locality": "Helsinki",
					"layer": "venue"
				}
			},
			{
				"geometry": { "type": "Point", "coordinates": [24.9410, 60.1710] },
				"properties": {
					"id": "stop:2",
					"gid": "gtfs:stop:HSL:1040601",
					"name": "Kamppi (M)",
					"label": "Kamppi (metro), Helsinki",
					"locality": "Helsinki",
					"layer": "stop"
				}
			}
		]
	}`

	var gotQuery string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(mockResponse))
	}))
	defer ts.Close()

	old := GeocodeURLEndpoint
	GeocodeURLEndpoint = ts.URL
	defer func() { GeocodeURLEndpoint = old }()

	memCache := cache.NewMemoryCache()
	gql := NewGraphQLClient("test-api-key")
	handlers := NewHandlers(memCache, gql, &mockMqttWorker{connected: true})

	req := httptest.NewRequest("GET", "/api/v1/geocode?text=kamppi&lat=60.17&lon=24.94", nil)
	rr := httptest.NewRecorder()
	handlers.Geocode(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	var resp GeocodeResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}

	if len(resp.Results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(resp.Results))
	}
	first := resp.Results[0]
	if first.Name != "Kamppi" {
		t.Errorf("expected name Kamppi, got %q", first.Name)
	}
	if first.Lat != 60.1690 || first.Lon != 24.9310 {
		t.Errorf("expected lat/lon 60.1690/24.9310, got %f/%f", first.Lat, first.Lon)
	}
	if first.ID != "openstreetmap:venue:node:1" {
		t.Errorf("expected gid as id, got %q", first.ID)
	}

	// Focus point should be forwarded upstream so nearby results rank first.
	if !strings.Contains(gotQuery, "focus.point.lat") {
		t.Errorf("expected focus.point.lat forwarded, query was %q", gotQuery)
	}
}

func TestHandlers_Geocode_MissingText(t *testing.T) {
	memCache := cache.NewMemoryCache()
	gql := NewGraphQLClient("test-api-key")
	handlers := NewHandlers(memCache, gql, &mockMqttWorker{connected: true})

	req := httptest.NewRequest("GET", "/api/v1/geocode?text=", nil)
	rr := httptest.NewRecorder()
	handlers.Geocode(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing text, got %d", rr.Code)
	}
}

func TestHandlers_Plan(t *testing.T) {
	mockResponse := `{
		"data": {
			"plan": {
				"itineraries": [
					{
						"duration": 1200,
						"walkDistance": 340.5,
						"startTime": 1750000000000,
						"endTime": 1750001200000,
						"legs": [
							{
								"mode": "WALK",
								"transitLeg": false,
								"duration": 180,
								"distance": 220.0,
								"startTime": 1750000000000,
								"endTime": 1750000180000,
								"headsign": null,
								"route": null,
								"legGeometry": { "points": "walk_poly" },
								"from": { "name": "Origin", "lat": 60.17, "lon": 24.94, "stop": null },
								"to": { "name": "Kamppi", "lat": 60.169, "lon": 24.931, "stop": { "gtfsId": "HSL:1040601", "name": "Kamppi", "code": "1234" } },
								"intermediatePlaces": []
							},
							{
								"mode": "TRAM",
								"transitLeg": true,
								"duration": 600,
								"distance": 2100.0,
								"startTime": 1750000200000,
								"endTime": 1750000800000,
								"headsign": "Pasila",
								"route": { "shortName": "9", "longName": "Pasila - Jätkäsaari", "color": "007AC9", "mode": "TRAM" },
								"legGeometry": { "points": "tram_poly" },
								"from": { "name": "Kamppi", "lat": 60.169, "lon": 24.931, "stop": { "gtfsId": "HSL:1040601", "name": "Kamppi", "code": "1234" } },
								"to": { "name": "Pasila", "lat": 60.199, "lon": 24.933, "stop": { "gtfsId": "HSL:1174501", "name": "Pasila", "code": "5678" } },
								"intermediatePlaces": [
									{ "name": "Sokos", "lat": 60.171, "lon": 24.941, "stop": { "gtfsId": "HSL:1020101", "name": "Sokos", "code": "0001" } }
								]
							}
						]
					}
				]
			}
		}
	}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(mockResponse))
	}))
	defer ts.Close()

	old := DigitransitURLEndpoint
	DigitransitURLEndpoint = ts.URL
	defer func() { DigitransitURLEndpoint = old }()

	memCache := cache.NewMemoryCache()
	gql := NewGraphQLClient("test-api-key")
	handlers := NewHandlers(memCache, gql, &mockMqttWorker{connected: true})

	req := httptest.NewRequest("GET", "/api/v1/plan?fromLat=60.17&fromLon=24.94&toLat=60.199&toLon=24.933", nil)
	rr := httptest.NewRecorder()
	handlers.Plan(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	var resp JourneyPlanResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}

	if len(resp.Itineraries) != 1 {
		t.Fatalf("expected 1 itinerary, got %d", len(resp.Itineraries))
	}
	it := resp.Itineraries[0]
	if it.Duration != 1200 {
		t.Errorf("expected duration 1200, got %d", it.Duration)
	}
	if it.Transfers != 0 {
		t.Errorf("expected 0 transfers, got %d", it.Transfers)
	}
	if len(it.Legs) != 2 {
		t.Fatalf("expected 2 legs, got %d", len(it.Legs))
	}

	walk := it.Legs[0]
	if walk.Transit {
		t.Error("expected walk leg transit=false")
	}
	if walk.Route != nil {
		t.Errorf("expected nil route on walk leg, got %+v", walk.Route)
	}

	tram := it.Legs[1]
	if !tram.Transit {
		t.Error("expected tram leg transit=true")
	}
	if tram.Route == nil || tram.Route.ShortName != "9" {
		t.Errorf("expected tram route 9, got %+v", tram.Route)
	}
	if tram.From.StopId != "HSL:1040601" {
		t.Errorf("expected board stop HSL:1040601, got %q", tram.From.StopId)
	}
	if tram.To.StopId != "HSL:1174501" {
		t.Errorf("expected alight stop HSL:1174501, got %q", tram.To.StopId)
	}
	if len(tram.IntermediateStops) != 1 || tram.IntermediateStops[0].StopId != "HSL:1020101" {
		t.Errorf("expected 1 intermediate stop HSL:1020101, got %+v", tram.IntermediateStops)
	}
	if tram.Geometry != "tram_poly" {
		t.Errorf("expected geometry tram_poly, got %q", tram.Geometry)
	}
}

func TestHandlers_Plan_BadCoords(t *testing.T) {
	memCache := cache.NewMemoryCache()
	gql := NewGraphQLClient("test-api-key")
	handlers := NewHandlers(memCache, gql, &mockMqttWorker{connected: true})

	req := httptest.NewRequest("GET", "/api/v1/plan?fromLat=abc&fromLon=24.94&toLat=60.19&toLon=24.93", nil)
	rr := httptest.NewRecorder()
	handlers.Plan(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for bad coords, got %d", rr.Code)
	}
}

func TestPlanModes(t *testing.T) {
	// WALK is always present.
	got := planModes("TRAM,BUS")
	hasWalk, hasTram, hasBus := false, false, false
	for _, m := range got {
		switch m["mode"] {
		case "WALK":
			hasWalk = true
		case "TRAM":
			hasTram = true
		case "BUS":
			hasBus = true
		}
	}
	if !hasWalk || !hasTram || !hasBus {
		t.Errorf("expected WALK+TRAM+BUS, got %+v", got)
	}

	// Empty string falls back to all transit modes (>1 entry incl. WALK).
	if all := planModes(""); len(all) <= 1 {
		t.Errorf("expected fallback to all modes, got %+v", all)
	}

	// Invalid-only input falls back to all transit modes.
	if fallback := planModes("banana"); len(fallback) <= 1 {
		t.Errorf("expected fallback for invalid modes, got %+v", fallback)
	}
}
