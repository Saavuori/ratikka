package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ratikka/internal/cache"
)

func TestNormalizeStopIDs(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{"prefixes bare ids", []string{"1203420"}, []string{"HSL:1203420"}},
		{"leaves prefixed ids alone", []string{"HSL:1203420"}, []string{"HSL:1203420"}},
		{"drops blanks", []string{"", "  ", "HSL:1"}, []string{"HSL:1"}},
		{
			"de-duplicates across prefix forms and sorts",
			[]string{"HSL:2", "1203420", "HSL:1203420", "HSL:2"},
			[]string{"HSL:1203420", "HSL:2"},
		},
		{"empty stays empty", nil, []string{}},
	}
	for _, tc := range cases {
		got := normalizeStopIDs(tc.in)
		if len(got) != len(tc.want) {
			t.Errorf("%s: expected %v, got %v", tc.name, tc.want, got)
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("%s: expected %v, got %v", tc.name, tc.want, got)
				break
			}
		}
	}
}

func TestNormalizeStopIDs_Caps(t *testing.T) {
	ids := make([]string, 0, MaxArrivalStops*2)
	for i := 0; i < MaxArrivalStops*2; i++ {
		ids = append(ids, string(rune('a'+i%26))+string(rune('a'+i/26)))
	}
	if got := len(normalizeStopIDs(ids)); got != MaxArrivalStops {
		t.Errorf("expected the request capped at %d stops, got %d", MaxArrivalStops, got)
	}
}

func TestArrivalsQuery_UsesVariablesNotInterpolation(t *testing.T) {
	q := arrivalsQuery(2)
	for _, want := range []string{"$id0: String!", "$id1: String!", "s0: stop(id: $id0)", "s1: stop(id: $id1)"} {
		if !strings.Contains(q, want) {
			t.Errorf("expected query to contain %q:\n%s", want, q)
		}
	}
	// Trip identity has to travel with a batched departure too, or the map can
	// label a stop but never point at the vehicle bringing the arrival.
	for _, want := range []string{"directionId", "departureStoptime", "serviceDay"} {
		if !strings.Contains(q, want) {
			t.Errorf("expected query to select %q", want)
		}
	}
}

func TestHandlers_StopsArrivals(t *testing.T) {
	var captured struct {
		Query     string                 `json:"query"`
		Variables map[string]interface{} `json:"variables"`
	}
	mockResponse := `{
		"data": {
			"s0": {
				"gtfsId": "HSL:1203420",
				"name": "Välimerenkatu",
				"stoptimesWithoutPatterns": [
					{
						"scheduledArrival": 33900,
						"realtimeArrival": 33840,
						"serviceDay": 1781470800,
						"scheduledDeparture": 33900,
						"realtimeDeparture": 33840,
						"realtime": true,
						"headsign": "Pasila",
						"trip": {
							"gtfsId": "HSL:1009_20260615_Su_2_0910",
							"directionId": "1",
							"departureStoptime": {"scheduledDeparture": 33000},
							"route": {"gtfsId": "HSL:1009", "shortName": "9", "color": "007AC9", "mode": "TRAM"}
						}
					}
				]
			},
			"s1": null
		}
	}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &captured)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(mockResponse))
	}))
	defer ts.Close()

	oldEndpoint := DigitransitURLEndpoint
	DigitransitURLEndpoint = ts.URL
	defer func() { DigitransitURLEndpoint = oldEndpoint }()

	handlers := NewHandlers(cache.NewMemoryCache(), NewGraphQLClient("test-api-key"), &mockMqttWorker{connected: true})
	req := httptest.NewRequest("GET", "/api/v1/stops/arrivals?id=HSL:1203420&id=9999999&id=HSL:1203420", nil)
	rr := httptest.NewRecorder()
	handlers.StopsArrivals(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d (body: %s)", rr.Code, rr.Body.String())
	}

	// Two distinct stops asked for, both as variables.
	if len(captured.Variables) != 2 {
		t.Errorf("expected 2 query variables, got %v", captured.Variables)
	}
	if captured.Variables["id0"] != "HSL:1203420" || captured.Variables["id1"] != "HSL:9999999" {
		t.Errorf("unexpected variables: %v", captured.Variables)
	}
	if strings.Contains(captured.Query, "HSL:1203420") {
		t.Error("stop ids must travel as variables, not be interpolated into the query")
	}

	var resp StopsArrivalsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.Stops) != 1 {
		t.Fatalf("expected 1 stop (the unknown one dropped), got %d", len(resp.Stops))
	}
	stop, ok := resp.Stops["HSL:1203420"]
	if !ok {
		t.Fatalf("expected the stop keyed by its gtfsId, got %v", resp.Stops)
	}
	if stop.Name != "Välimerenkatu" || len(stop.Departures) != 1 {
		t.Fatalf("unexpected stop payload: %+v", stop)
	}
	dep := stop.Departures[0]
	if dep.Line != "9" || dep.RouteId != "HSL:1009" || dep.ServiceDate != "2026-06-15" || dep.Mode != "TRAM" {
		t.Errorf("batched departure lost its identity: %+v", dep)
	}
	if dep.DirectionId == nil || *dep.DirectionId != 1 {
		t.Errorf("expected direction 1, got %v", dep.DirectionId)
	}
	if dep.StartTimeSeconds == nil || *dep.StartTimeSeconds != 33000 {
		t.Errorf("expected origin 33000, got %v", dep.StartTimeSeconds)
	}
	if resp.FetchedAt <= 0 {
		t.Error("expected a fetchedAt timestamp")
	}
}

func TestHandlers_StopsArrivals_RequiresAnID(t *testing.T) {
	handlers := NewHandlers(cache.NewMemoryCache(), NewGraphQLClient("test-api-key"), &mockMqttWorker{connected: true})
	rr := httptest.NewRecorder()
	handlers.StopsArrivals(rr, httptest.NewRequest("GET", "/api/v1/stops/arrivals", nil))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", rr.Code)
	}
}
