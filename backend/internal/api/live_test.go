package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"ratikka/internal/cache"
)

func liveHandlers(t *testing.T, upstream http.HandlerFunc) (*Handlers, http.Handler) {
	t.Helper()
	server := httptest.NewServer(upstream)
	old := DigitransitURLEndpoint
	DigitransitURLEndpoint = server.URL
	t.Cleanup(func() {
		DigitransitURLEndpoint = old
		server.Close()
	})
	h := NewHandlers(cache.NewMemoryCache(), NewGraphQLClient(""), &mockMqttWorker{})
	return h, NewRouter(h, nil)
}

func getLive(t *testing.T, router http.Handler, path string, status int, out interface{}) string {
	t.Helper()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	if rec.Code != status {
		t.Fatalf("%s: status %d, want %d: %s", path, rec.Code, status, rec.Body.String())
	}
	if out != nil {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatal(err)
		}
	}
	return rec.Body.String()
}

func TestLiveStopDepartures(t *testing.T) {
	calls := 0
	_, router := liveHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		var req graphQLRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		for _, field := range []string{"scheduledDeparture", "realtimeDeparture", "departureDelay", "serviceDay", "platformCode", "omitCanceled: false"} {
			if !strings.Contains(req.Query, field) {
				t.Errorf("missing upstream field/argument %s", field)
			}
		}
		fmt.Fprint(w, `{"data":{"stop":{"gtfsId":"HSL:S","name":"Platform","platformCode":"4","stoptimesWithoutPatterns":[
			{"scheduledArrival":86340,"realtimeArrival":86400,"arrivalDelay":60,
			 "scheduledDeparture":87000,"realtimeDeparture":87120,"departureDelay":120,
			 "serviceDay":1788555600,"realtime":true,"realtimeState":"CANCELED",
			 "trip":{"gtfsId":"HSL:T","route":{"shortName":"9"}}},
			{"scheduledDeparture":300,"realtimeDeparture":null,"serviceDay":null},
			{"scheduledDeparture":null,"realtimeDeparture":null,"serviceDay":1788555600},
			{"scheduledDeparture":600,"realtimeDeparture":600,"serviceDay":0}
		]}}}`)
	})
	before := time.Now().UnixMilli()
	var out StopDetailsResponse
	body := getLive(t, router, "/api/v1/stop/HSL:S", 200, &out)
	if out.Stop.PlatformCode != "4" || out.FetchedAt < before || out.FetchedAt > time.Now().UnixMilli() {
		t.Fatalf("missing platform/fetch timestamp: %+v", out)
	}
	d := out.Departures[0]
	if d.ScheduledArrival != "23:59" || d.RealtimeArrival != "00:00" ||
		d.ScheduledDeparture != "00:10" || d.RealtimeDeparture != "00:12" ||
		d.ScheduledDepartureTime != (1788555600+87000)*1000 ||
		d.RealtimeDepartureTime != (1788555600+87120)*1000 ||
		d.Delay != 60 || d.DepartureDelay != 120 || !d.Realtime || d.RealtimeState != "CANCELED" {
		t.Fatalf("arrival/departure or overnight data lost: %+v", d)
	}
	for _, d := range out.Departures[1:] {
		if d.ScheduledDepartureTime != 0 || d.RealtimeDepartureTime != 0 {
			t.Errorf("unknown timestamp invented: %+v", d)
		}
	}
	var wire struct {
		Departures []map[string]interface{} `json:"departures"`
	}
	if err := json.Unmarshal([]byte(body), &wire); err != nil {
		t.Fatal(err)
	}
	for _, d := range wire.Departures[1:] {
		if _, present := d["scheduledDepartureTime"]; present {
			t.Errorf("missing timestamp not omitted: %v", d)
		}
	}
	if cached := getLive(t, router, "/api/v1/stop/HSL:S", 200, nil); cached != body || calls != 1 {
		t.Fatalf("cache regenerated fetch timestamp or fetched again, calls=%d", calls)
	}
}

func TestServiceTimestampUnknownAndOverflow(t *testing.T) {
	for _, day := range []int64{0, -1, math.MaxInt64} {
		seconds := 90000
		if got := serviceTimestamp(&day, &seconds); got != 0 {
			t.Errorf("invalid service day %d yielded %d", day, got)
		}
	}
	day := int64(1788555600)
	seconds := 0
	if got := serviceTimestamp(&day, &seconds); got != day*1000 {
		t.Errorf("valid midnight lost: %d", got)
	}
}

func TestNearbyStopsSortedBoundedAndCached(t *testing.T) {
	calls := 0
	_, router := liveHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		var req graphQLRequest
		json.NewDecoder(r.Body).Decode(&req)
		if req.Variables["radius"] != float64(1000) {
			t.Errorf("default radius = %v", req.Variables["radius"])
		}
		for _, part := range []string{"stopsByRadius(", "first: 10", "edges { node { stop", "distance", "platformCode"} {
			if !strings.Contains(req.Query, part) {
				t.Errorf("unsupported nearby query shape, missing %q", part)
			}
		}
		fmt.Fprint(w, `{"data":{"stopsByRadius":{"edges":[null,{"node":null},{"node":{"stop":null,"distance":1}},{"node":{"stop":{"gtfsId":"unknown"}}}`)
		for i := 12; i >= 0; i-- {
			fmt.Fprintf(w, `,{"node":{"stop":{"gtfsId":"HSL:%d","name":"Stop","code":"1","lat":60.17,"lon":24.94,"platformCode":"A"},"distance":%d}}`, i, i*20)
		}
		fmt.Fprint(w, `]}}}`)
	})
	var out NearbyStopsResponse
	body := getLive(t, router, "/api/v1/stops/nearby?lat=60.17&lon=24.94", 200, &out)
	if len(out.Stops) != 10 || out.FetchedAt == 0 {
		t.Fatalf("invalid nearby response: %+v", out)
	}
	for i, s := range out.Stops {
		if s.GtfsId != fmt.Sprintf("HSL:%d", i) || s.Distance != float64(i*20) || s.PlatformCode != "A" {
			t.Errorf("wrong ordering/metadata at %d: %+v", i, s)
		}
	}
	if got := getLive(t, router, "/api/v1/stops/nearby?lat=60.17&lon=24.94&radius=1000", 200, nil); got != body || calls != 1 {
		t.Fatal("default radius and explicit radius should share cached timestamp")
	}
}

func TestNearbyStopsValidationAndUpstreamFailures(t *testing.T) {
	calls := 0
	_, router := liveHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		fmt.Fprint(w, `{"data":{"stopsByRadius":null}}`)
	})
	for _, q := range []string{
		"", "lat=NaN&lon=24", "lat=Inf&lon=24", "lat=91&lon=24",
		"lat=60&lon=-181", "lat=60&lon=24&radius=0", "lat=60&lon=24&radius=-1",
		"lat=60&lon=24&radius=3001", "lat=60&lon=24&radius=1.5", "lat=60&lon=24&radius=",
	} {
		getLive(t, router, "/api/v1/stops/nearby?"+q, 400, nil)
	}
	if calls != 0 {
		t.Fatal("invalid inputs reached upstream")
	}
	getLive(t, router, "/api/v1/stops/nearby?lat=90&lon=-180&radius=3000", 502, nil)
}

const liveLegFixture = `{
	"id":"stable-leg", "mode":"TRAM", "transitLeg":true,
	"startTime":1788643200000,"endTime":1788643800000,
	"serviceDate":"20260905","realTime":true,"realtimeState":"UPDATED",
	"departureDelay":120,"arrivalDelay":180,
	"trip":{"gtfsId":"HSL:TRIP","directionId":"0","departureStoptime":{"scheduledDeparture":87000}},
	"route":{"gtfsId":"HSL:1009","shortName":"9"},
	"from":{"stop":{"gtfsId":"HSL:A","platformCode":"1"}},
	"to":{"stop":{"gtfsId":"HSL:B","platformCode":"2"}}
}`

func TestLivePlanIdentityDateAndCache(t *testing.T) {
	var requests []graphQLRequest
	_, router := liveHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		var req graphQLRequest
		json.NewDecoder(r.Body).Decode(&req)
		requests = append(requests, req)
		for _, part := range []string{"date: $date", "time: $time", "serviceDate", "realTime", "realtimeState", "directionId", "departureStoptime", "platformCode"} {
			if !strings.Contains(req.Query, part) {
				t.Errorf("plan query missing %s", part)
			}
		}
		fmt.Fprintf(w, `{"data":{"plan":{"itineraries":[{"legs":[%s]}]}}}`, liveLegFixture)
	})
	base := "/api/v1/plan?fromLat=60&fromLon=24&toLat=61&toLon=25"
	path := base + "&date=2026-09-05&time=23:50"
	var out JourneyPlanResponse
	body := getLive(t, router, path, 200, &out)
	if out.FetchedAt == 0 || len(out.Itineraries) != 1 {
		t.Fatalf("invalid plan: %+v", out)
	}
	leg := out.Itineraries[0].Legs[0]
	if leg.TripId != "HSL:TRIP" || leg.LegId != "stable-leg" ||
		leg.ServiceDate != "2026-09-05" || leg.DirectionId == nil || *leg.DirectionId != 0 ||
		leg.StartTimeSeconds == nil || *leg.StartTimeSeconds != 87000 ||
		!leg.Realtime || leg.RealtimeState != "UPDATED" || leg.DepartureDelay != 120 || leg.ArrivalDelay != 180 ||
		leg.ScheduledStartTime != leg.StartTime-120000 || leg.ScheduledEndTime != leg.EndTime-180000 ||
		leg.Route.GtfsId != "HSL:1009" || leg.From.PlatformCode != "1" || leg.To.PlatformCode != "2" {
		t.Fatalf("live identity or timing lost: %+v", leg)
	}
	if cached := getLive(t, router, path, 200, nil); cached != body || len(requests) != 1 {
		t.Fatal("plan cache did not retain original fetchedAt")
	}
	for _, p := range []string{
		base + "&date=2026-09-06&time=23:50",
		base + "&date=2026-09-05&time=23:51",
		path + "&arriveBy=true",
		path + "&modes=BUS",
		path + "&numItineraries=6",
		base,
	} {
		getLive(t, router, p, 200, nil)
	}
	if len(requests) != 7 {
		t.Fatalf("distinct planning parameters must not share caches: %d fetches", len(requests))
	}
	if requests[0].Variables["date"] != "2026-09-05" || requests[0].Variables["time"] != "23:50" ||
		requests[3].Variables["arriveBy"] != true {
		t.Fatalf("Helsinki wall-clock values or arriveBy not forwarded: %+v", requests)
	}
	if _, present := requests[6].Variables["date"]; present {
		t.Fatal("depart-now plan unexpectedly fixed to a date")
	}
}

func TestLivePlanValidation(t *testing.T) {
	_, router := liveHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("invalid plan request reached upstream")
	})
	base := "/api/v1/plan?fromLat=60&fromLon=24&toLat=61&toLon=25"
	for _, tail := range []string{
		"&date=2026-09-05", "&time=12:00", "&date=&time=",
		"&date=2026-02-29&time=12:00", "&date=2026-09-31&time=12:00",
		"&date=2026-09-05&time=24:00", "&date=2026-09-05&time=23:60",
		"&date=2026-9-5&time=12:00", "&date=2026-09-05&time=1:00",
	} {
		getLive(t, router, base+tail, 400, nil)
	}
	for _, pair := range []struct{ key, value string }{
		{"fromLat", "NaN"}, {"fromLon", "Inf"}, {"toLat", "-91"}, {"toLon", "181"},
	} {
		u, _ := url.Parse(base)
		q := u.Query()
		q.Set(pair.key, pair.value)
		u.RawQuery = q.Encode()
		getLive(t, router, u.String(), 400, nil)
	}
}

func TestLivePlanMalformedOptionalIdentity(t *testing.T) {
	for _, values := range []string{
		`"serviceDate":null,"trip":null`,
		`"serviceDate":"invalid","trip":{"directionId":"unknown","departureStoptime":null}`,
		`"serviceDate":"20260230","trip":{"directionId":null,"departureStoptime":{"scheduledDeparture":null}}`,
		`"trip":{"directionId":{},"departureStoptime":{"scheduledDeparture":-1}}`,
	} {
		var raw rawPlanLeg
		if err := json.Unmarshal([]byte(`{"transitLeg":true,"startTime":1788643200000,`+values+`}`), &raw); err != nil {
			t.Fatal(err)
		}
		leg := toJourneyLeg(raw)
		if leg.ServiceDate != "" || leg.DirectionId != nil || leg.StartTimeSeconds != nil || leg.ScheduledStartTime != 0 {
			t.Errorf("missing identity must not be inferred from leg's calendar day: %+v", leg)
		}
	}
}

func TestMonitorJourneyPreservesSelectionAndCancellation(t *testing.T) {
	calls := 0
	_, router := liveHandlers(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		var req graphQLRequest
		json.NewDecoder(r.Body).Decode(&req)
		if !strings.Contains(req.Query, "leg0: leg(id: $leg0)") ||
			req.Variables["leg0"] != "stable-leg" || req.Variables["leg1"] != "missing-leg" ||
			strings.Contains(req.Query, "plan(") {
			t.Errorf("monitor must refresh original leg IDs, not replan: %+v", req)
		}
		fmt.Fprintf(w, `{"data":{"leg0":%s,"leg1":null}}`, strings.ReplaceAll(liveLegFixture, "UPDATED", "CANCELED"))
	})
	path := "/api/v1/journey/monitor?legId=stable-leg&legId=missing-leg"
	var out JourneyMonitorResponse
	body := getLive(t, router, path, 200, &out)
	if len(out.Legs) != 2 || out.Legs[0] == nil || out.Legs[1] != nil ||
		out.Legs[0].LegId != "stable-leg" || out.Legs[0].RealtimeState != "CANCELED" || out.FetchedAt == 0 {
		t.Fatalf("monitor lost original selection/cancellation/missing leg: %+v", out)
	}
	if got := getLive(t, router, path, 200, nil); got != body || calls != 1 {
		t.Fatal("monitor response/timestamp not cached")
	}
	for _, q := range []string{"", "?legId=", "?legId=" + strings.Repeat("x", 2049), "?" + strings.Repeat("legId=x&", 9)} {
		getLive(t, router, "/api/v1/journey/monitor"+q, 400, nil)
	}
}
