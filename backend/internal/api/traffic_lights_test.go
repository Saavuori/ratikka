package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ratikka/internal/cache"
)

func TestHandlers_TrafficLights(t *testing.T) {
	trafficLightsResp := `{
		"type": "FeatureCollection",
		"features": [
			{
				"type": "Feature",
				"geometry": { "type": "Point", "coordinates": [24.9310, 60.1690] },
				"properties": { "id": 45, "numero": 27, "tyyppi": "Liikennevalot", "risteys": "Huopalahdentie/Tietokuja" }
			}
		]
	}`
	warningLightsResp := `{
		"type": "FeatureCollection",
		"features": [
			{
				"type": "Feature",
				"geometry": { "type": "Point", "coordinates": [24.9377, 60.1611] },
				"properties": { "id": 1, "numero": 946, "tyyppi": "Varoitusvalot", "risteys": "Albertinkatu" }
			}
		]
	}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Query().Get("typeNames") {
		case "avoindata:Liikennevalot_piste":
			w.Write([]byte(trafficLightsResp))
		case "avoindata:Varoitusvalot_piste":
			w.Write([]byte(warningLightsResp))
		default:
			t.Errorf("unexpected typeNames %q", r.URL.Query().Get("typeNames"))
		}
	}))
	defer ts.Close()

	old := TrafficLightsWFSEndpoint
	TrafficLightsWFSEndpoint = ts.URL
	defer func() { TrafficLightsWFSEndpoint = old }()

	memCache := cache.NewMemoryCache()
	gql := NewGraphQLClient("")
	handlers := NewHandlers(memCache, gql, &mockMqttWorker{connected: true})

	req := httptest.NewRequest("GET", "/api/v1/traffic-lights", nil)
	rr := httptest.NewRecorder()
	handlers.TrafficLights(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	var resp trafficLightsFeatureCollection
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}

	if resp.Type != "FeatureCollection" {
		t.Errorf("expected type FeatureCollection, got %q", resp.Type)
	}
	if len(resp.Features) != 2 {
		t.Fatalf("expected 2 features, got %d", len(resp.Features))
	}

	byJunction := map[string]trafficLightFeature{}
	for _, f := range resp.Features {
		byJunction[f.Properties.Junction] = f
	}

	light, ok := byJunction["Huopalahdentie/Tietokuja"]
	if !ok {
		t.Fatal("expected a feature for Huopalahdentie/Tietokuja")
	}
	if light.Properties.Type != "traffic_light" {
		t.Errorf("expected type traffic_light, got %q", light.Properties.Type)
	}
	if light.Properties.ID != 27 {
		t.Errorf("expected id 27, got %d", light.Properties.ID)
	}
	if light.Geometry.Coordinates != [2]float64{24.9310, 60.1690} {
		t.Errorf("unexpected coordinates %v", light.Geometry.Coordinates)
	}

	// Junction 27 is not in the recentring table, so it is served exactly as
	// the open data gave it — an unknown junction keeps its own point.
	if light.Properties.Centered {
		t.Error("a signal outside the recentring table must not be flagged as centered")
	}

	warning, ok := byJunction["Albertinkatu"]
	if !ok {
		t.Fatal("expected a feature for Albertinkatu")
	}
	if warning.Properties.Type != "warning_light" {
		t.Errorf("expected type warning_light, got %q", warning.Properties.Type)
	}
}

// A signal the table knows is served at the middle of its junction instead of
// at the mast the open data surveyed — and where the open data lists two masts
// under one junction number, the pair becomes one marker rather than two on
// top of each other.
func TestHandlers_TrafficLights_Recentred(t *testing.T) {
	center, ok := junctionCenters["traffic_light:333"]
	if !ok {
		t.Skip("junction 333 is no longer in the generated table")
	}

	// Mäkelänkatu/Päijänteentie/Vallilantie, whose two masts share number 333.
	trafficLightsResp := `{
		"type": "FeatureCollection",
		"features": [
			{
				"type": "Feature",
				"geometry": { "type": "Point", "coordinates": [24.96128077, 60.19191908] },
				"properties": { "id": 331, "numero": 333, "tyyppi": "Liikennevalot", "risteys": "Mäkelänkatu/Päijänteentie/Vallilantie" }
			},
			{
				"type": "Feature",
				"geometry": { "type": "Point", "coordinates": [24.96081818, 60.19234814] },
				"properties": { "id": 332, "numero": 333, "tyyppi": "Liikennevalot", "risteys": "Mäkelänkatu/Päijänteentie/Vallilantie" }
			}
		]
	}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("typeNames") == "avoindata:Liikennevalot_piste" {
			w.Write([]byte(trafficLightsResp))
			return
		}
		w.Write([]byte(`{"type":"FeatureCollection","features":[]}`))
	}))
	defer ts.Close()

	old := TrafficLightsWFSEndpoint
	TrafficLightsWFSEndpoint = ts.URL
	defer func() { TrafficLightsWFSEndpoint = old }()

	handlers := NewHandlers(cache.NewMemoryCache(), NewGraphQLClient(""), &mockMqttWorker{connected: true})
	req := httptest.NewRequest("GET", "/api/v1/traffic-lights", nil)
	rr := httptest.NewRecorder()
	handlers.TrafficLights(rr, req)

	var resp trafficLightsFeatureCollection
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if len(resp.Features) != 1 {
		t.Fatalf("expected the two masts of junction 333 to collapse to one feature, got %d", len(resp.Features))
	}
	f := resp.Features[0]
	if f.Geometry.Coordinates != center {
		t.Errorf("expected the junction centre %v, got %v", center, f.Geometry.Coordinates)
	}
	if !f.Properties.Centered {
		t.Error("expected a recentred signal to say so")
	}
}

func TestHandlers_TrafficLights_Cached(t *testing.T) {
	calls := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"type":"FeatureCollection","features":[]}`))
	}))
	defer ts.Close()

	old := TrafficLightsWFSEndpoint
	TrafficLightsWFSEndpoint = ts.URL
	defer func() { TrafficLightsWFSEndpoint = old }()

	memCache := cache.NewMemoryCache()
	gql := NewGraphQLClient("")
	handlers := NewHandlers(memCache, gql, &mockMqttWorker{connected: true})

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("GET", "/api/v1/traffic-lights", nil)
		rr := httptest.NewRecorder()
		handlers.TrafficLights(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i, rr.Code)
		}
	}

	// Two layers fetched once each; subsequent requests should be served from cache.
	if calls != 2 {
		t.Errorf("expected upstream to be called exactly twice (once per layer), got %d", calls)
	}
}

func TestHandlers_TrafficLights_UpstreamError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	old := TrafficLightsWFSEndpoint
	TrafficLightsWFSEndpoint = ts.URL
	defer func() { TrafficLightsWFSEndpoint = old }()

	memCache := cache.NewMemoryCache()
	gql := NewGraphQLClient("")
	handlers := NewHandlers(memCache, gql, &mockMqttWorker{connected: true})

	req := httptest.NewRequest("GET", "/api/v1/traffic-lights", nil)
	rr := httptest.NewRecorder()
	handlers.TrafficLights(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", rr.Code)
	}
}
