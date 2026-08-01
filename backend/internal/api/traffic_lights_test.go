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

	warning, ok := byJunction["Albertinkatu"]
	if !ok {
		t.Fatal("expected a feature for Albertinkatu")
	}
	if warning.Properties.Type != "warning_light" {
		t.Errorf("expected type warning_light, got %q", warning.Properties.Type)
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
