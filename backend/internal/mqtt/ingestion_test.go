package mqtt

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"ratikka/internal/cache"
	"ratikka/internal/replay"
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

	cachedBytes, exists := positions["22-229"]
	if !exists {
		t.Fatal("expected vehicle 22-229 to be cached")
	}

	var thinned VehiclePosition
	if err := json.Unmarshal(cachedBytes, &thinned); err != nil {
		t.Fatalf("failed to unmarshal cached bytes: %v", err)
	}

	// Verify thinned fields match
	if thinned.Veh != "22-229" {
		t.Errorf("expected Veh \"22-229\", got %q", thinned.Veh)
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
	// HFP's dl counts seconds ahead of schedule, so -15 there is 15 seconds
	// late here; see normalizeDelay.
	if thinned.Dl != 15 {
		t.Errorf("expected Dl 15, got %d", thinned.Dl)
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
	if thinned.NextStop == nil || *thinned.NextStop != "HSL:1203420" {
		t.Errorf("expected NextStop HSL:1203420, got %v", thinned.NextStop)
	}
	if thinned.Eol {
		t.Error("expected Eol false")
	}
	if thinned.Ts != 1781461815 {
		t.Errorf("expected Ts 1781461815, got %d", thinned.Ts)
	}
	if thinned.TripId != "HSL:1009_20260615_Mo_1_0915" {
		t.Errorf("expected TripId HSL:1009_20260615_Mo_1_0915, got %q", thinned.TripId)
	}
	if thinned.Mode != "tram" {
		t.Errorf("expected Mode tram, got %q", thinned.Mode)
	}
	if thinned.Odo == nil || *thinned.Odo != 12456 {
		t.Errorf("expected Odo 12456, got %v", thinned.Odo)
	}
	if thinned.Loc == nil || *thinned.Loc != "GPS" {
		t.Errorf("expected Loc GPS, got %v", thinned.Loc)
	}
	if thinned.Oper == nil || *thinned.Oper != 22 {
		t.Errorf("expected Oper 22, got %v", thinned.Oper)
	}
	if thinned.Jrn == nil || *thinned.Jrn != 456 {
		t.Errorf("expected Jrn 456, got %v", thinned.Jrn)
	}
	if thinned.Occu == nil || *thinned.Occu != 0 {
		t.Errorf("expected Occu 0, got %v", thinned.Occu)
	}
	if thinned.Dir != "1" {
		t.Errorf("expected Dir 1, got %q", thinned.Dir)
	}
	if thinned.Oday != "2026-06-15" {
		t.Errorf("expected Oday 2026-06-15, got %q", thinned.Oday)
	}
	if thinned.Start != "09:15" {
		t.Errorf("expected Start 09:15, got %q", thinned.Start)
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

			cachedBytes, exists := positions["unknown-229"]
			if !exists {
				t.Fatal("expected vehicle unknown-229 in cache")
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

// Metro and commuter-train messages ride the same VP payload on the same topic
// layout, so the mode comes straight from the topic and the rest parses as it
// does for trams.
func TestIngestionWorker_HandleMessage_RailModes(t *testing.T) {
	cases := []struct {
		name     string
		topic    string
		payload  string
		wantVeh  string
		wantMode string
		wantDesi string
	}{
		{
			name:     "metro",
			topic:    "/hfp/v2/journey/ongoing/vp/metro/0050/00117/31M1/2/Kivenlahti/21:12/2441604/3/60;24/16/59/17",
			payload:  `{"VP":{"desi":"M1","dir":"2","oper":50,"veh":117,"tsi":1788289014,"spd":17.2,"hdg":264,"lat":60.1517348,"long":24.69718703,"oday":"2026-06-15","start":"21:12","loc":"MAN","stop":null,"route":"31M1"}}`,
			wantVeh:  "0050-117",
			wantMode: "metro",
			wantDesi: "M1",
		},
		{
			name:     "train",
			topic:    "/hfp/v2/journey/ongoing/vp/train/0090/06305/3001R/1/Riihimäki/21:40/9040501/4/60;25/30/26/52",
			payload:  `{"VP":{"desi":"R","dir":"1","oper":90,"veh":6305,"tsi":1788289014,"spd":37.77,"hdg":25,"lat":60.325988,"long":25.062390,"dl":86,"oday":"2026-06-15","start":"21:40","loc":"GPS","stop":null,"route":"3001R"}}`,
			wantVeh:  "0090-6305",
			wantMode: "train",
			wantDesi: "R",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			memCache := cache.NewMemoryCache()
			worker := NewIngestionWorker("tls://mock:8883", memCache)
			worker.handleMessage(nil, &mockMessage{payload: []byte(tc.payload), topic: tc.topic})

			positions, err := memCache.GetAllPositions(context.Background())
			if err != nil {
				t.Fatalf("failed to read positions: %v", err)
			}
			data, ok := positions[tc.wantVeh]
			if !ok {
				t.Fatalf("expected position cached for %s, got %v", tc.wantVeh, positions)
			}
			var thinned VehiclePosition
			if err := json.Unmarshal(data, &thinned); err != nil {
				t.Fatalf("failed to unmarshal cached position: %v", err)
			}
			if thinned.Mode != tc.wantMode {
				t.Errorf("expected Mode %q, got %q", tc.wantMode, thinned.Mode)
			}
			if thinned.Desi != tc.wantDesi {
				t.Errorf("expected Desi %q, got %q", tc.wantDesi, thinned.Desi)
			}
			if thinned.Lat == 0 || thinned.Lng == 0 {
				t.Errorf("expected coordinates, got %f/%f", thinned.Lat, thinned.Lng)
			}
		})
	}
}

// Both units of a coupled metro train publish the same journey. Only the first
// one seen is ingested, so the journey draws as a single vehicle.
func TestIngestionWorker_MetroCoupledUnitsDeduped(t *testing.T) {
	memCache := cache.NewMemoryCache()
	worker := NewIngestionWorker("tls://mock:8883", memCache)

	unit := func(veh int, lat float64) *mockMessage {
		return &mockMessage{
			payload: []byte(fmt.Sprintf(
				`{"VP":{"desi":"M1","dir":"2","oper":50,"veh":%d,"tsi":1788289014,"spd":17.2,"hdg":264,"lat":%f,"long":24.697,"oday":"2026-06-15","start":"21:12","loc":"MAN","route":"31M1"}}`,
				veh, lat)),
			topic: fmt.Sprintf("/hfp/v2/journey/ongoing/vp/metro/0050/%05d/31M1/2/Kivenlahti/21:12/2441604/3/60;24/16/59/17", veh),
		}
	}

	worker.handleMessage(nil, unit(117, 60.1517))
	worker.handleMessage(nil, unit(119, 60.1516))
	worker.handleMessage(nil, unit(117, 60.1518))

	positions, err := memCache.GetAllPositions(context.Background())
	if err != nil {
		t.Fatalf("failed to read positions: %v", err)
	}
	if len(positions) != 1 {
		t.Fatalf("expected 1 cached vehicle for the journey, got %d: %v", len(positions), positions)
	}
	if _, ok := positions["0050-117"]; !ok {
		t.Errorf("expected the first unit seen (0050-117) to be kept, got %v", positions)
	}
}

// A different journey on the same line is its own vehicle, never deduped away.
func TestIngestionWorker_MetroSeparateJourneysKept(t *testing.T) {
	memCache := cache.NewMemoryCache()
	worker := NewIngestionWorker("tls://mock:8883", memCache)

	journey := func(veh int, start string) *mockMessage {
		return &mockMessage{
			payload: []byte(fmt.Sprintf(
				`{"VP":{"desi":"M1","dir":"2","oper":50,"veh":%d,"tsi":1788289014,"spd":17.2,"hdg":264,"lat":60.15,"long":24.69,"oday":"2026-06-15","start":"%s","loc":"MAN","route":"31M1"}}`,
				veh, start)),
			topic: "/hfp/v2/journey/ongoing/vp/metro/0050/00117/31M1/2/Kivenlahti/" + start + "/2441604/3/60;24/16/59/17",
		}
	}

	worker.handleMessage(nil, journey(117, "21:12"))
	worker.handleMessage(nil, journey(203, "21:24"))

	positions, err := memCache.GetAllPositions(context.Background())
	if err != nil {
		t.Fatalf("failed to read positions: %v", err)
	}
	if len(positions) != 2 {
		t.Fatalf("expected 2 cached vehicles, got %d: %v", len(positions), positions)
	}
}

func TestIngestionWorker_OptionalModes(t *testing.T) {
	for _, mode := range []string{"bus", "metro", "train"} {
		if !IsOptionalMode(mode) {
			t.Errorf("expected %q to be an optional mode", mode)
		}
	}
	if IsOptionalMode("tram") {
		t.Error("trams always stream; they must not be an optional mode")
	}
	if IsOptionalMode("ferry") {
		t.Error("ferry is not ingested, so it must not be an optional mode")
	}

	// Enabling/disabling without a live MQTT client must not panic and must be
	// idempotent — the state is what a reconnect replays.
	worker := NewIngestionWorker("tls://mock:8883", cache.NewMemoryCache())
	worker.EnableMode("metro")
	worker.EnableMode("metro")
	worker.EnableMode("nonsense")
	if !worker.enabledModes["metro"] {
		t.Error("expected metro ingestion to be enabled")
	}
	if worker.enabledModes["nonsense"] {
		t.Error("expected unknown modes to be ignored")
	}
	worker.DisableMode("metro")
	if worker.enabledModes["metro"] {
		t.Error("expected metro ingestion to be disabled")
	}
}

// countingCache records how many writes actually reach the position cache, which
// is the whole point of dropping duplicate readings: an identical message costs
// a Redis round-trip it has no reason to cost.
type countingCache struct {
	cache.Cache
	writes int
}

func (c *countingCache) SetPosition(ctx context.Context, vehicleID string, payload []byte) error {
	c.writes++
	return c.Cache.SetPosition(ctx, vehicleID, payload)
}

// HSL delivers each tram VP message four times over; only the first is worth
// storing. See dedupeTTL.
func TestIngestionWorker_DuplicateReadingsDropped(t *testing.T) {
	counting := &countingCache{Cache: cache.NewMemoryCache()}
	worker := NewIngestionWorker("tls://mock:8883", counting)

	reading := func(tsi int64, lat float64) *mockMessage {
		return &mockMessage{
			payload: []byte(fmt.Sprintf(
				`{"VP":{"desi":"9","dir":"1","oper":40,"veh":90,"tsi":%d,"spd":6.2,"acc":0.3,"hdg":225,"lat":%f,"long":24.9687,"oday":"2026-09-05","start":"20:54","route":"1009"}}`,
				tsi, lat)),
			topic: "/hfp/v2/journey/ongoing/vp/tram/0040/00090/1009/1/Eiranranta/20:54/1230410/5/60;24/29/06/3",
		}
	}

	// The same reading four times, as the live feed delivers it.
	for i := 0; i < 4; i++ {
		worker.handleMessage(nil, reading(1788630995, 60.203964))
	}
	if counting.writes != 1 {
		t.Errorf("expected 1 write for 4 identical readings, got %d", counting.writes)
	}

	// A new timestamp on the same coordinate is a real report: the vehicle is
	// standing still, and the sweeper reads that timestamp to know it is alive.
	worker.handleMessage(nil, reading(1788630996, 60.203964))
	if counting.writes != 2 {
		t.Errorf("expected a fresh timestamp to be stored, got %d writes", counting.writes)
	}

	// So is a new coordinate under a repeated timestamp.
	worker.handleMessage(nil, reading(1788630996, 60.204120))
	if counting.writes != 3 {
		t.Errorf("expected a fresh coordinate to be stored, got %d writes", counting.writes)
	}
}

// Two vehicles reporting the same timestamp and coordinate are two vehicles.
// Deduping is per vehicle, never across the fleet.
func TestIngestionWorker_DedupeIsPerVehicle(t *testing.T) {
	counting := &countingCache{Cache: cache.NewMemoryCache()}
	worker := NewIngestionWorker("tls://mock:8883", counting)

	reading := func(veh int) *mockMessage {
		return &mockMessage{
			payload: []byte(fmt.Sprintf(
				`{"VP":{"desi":"9","dir":"1","oper":40,"veh":%d,"tsi":1788630995,"spd":0,"hdg":225,"lat":60.203964,"long":24.9687,"oday":"2026-09-05","start":"20:54","route":"1009"}}`,
				veh)),
			topic: fmt.Sprintf("/hfp/v2/journey/ongoing/vp/tram/0040/%05d/1009/1/Eiranranta/20:54/1230410/5/60;24/29/06/3", veh),
		}
	}

	worker.handleMessage(nil, reading(90))
	worker.handleMessage(nil, reading(91))
	if counting.writes != 2 {
		t.Errorf("expected both vehicles stored, got %d writes", counting.writes)
	}
}

// The next stop is read off the topic, because that is the only place it is
// always stated. These are the shapes level 13 comes in.
func TestParseNextStop(t *testing.T) {
	cases := []struct {
		name  string
		topic string
		want  string
		eol   bool
	}{
		{
			name:  "bare id is prefixed",
			topic: "/hfp/v2/journey/ongoing/vp/tram/0040/00456/1005T/1/Katajanokan term./17:36/1020450/5/60;24/19/65/90",
			want:  "HSL:1020450",
		},
		{
			name:  "already prefixed id is left alone",
			topic: "/hfp/v2/journey/ongoing/vp/tram/22/229/HSL:1009/1/Jätkäsaari/09:15/HSL:1203420/14/60.17/24.94",
			want:  "HSL:1203420",
		},
		{
			name:  "end of line names no stop",
			topic: "/hfp/v2/journey/ongoing/vp/tram/0040/00456/1005T/1/Katajanokan term./17:36/EOL/5/60;24/19/65/90",
			eol:   true,
		},
		{
			name:  "empty level names no stop",
			topic: "/hfp/v2/journey/ongoing/vp/tram/0040/00456/1005T/1/Katajanokan term./17:36//5/60;24/19/65/90",
		},
		{
			name:  "literal null names no stop",
			topic: "/hfp/v2/journey/ongoing/vp/tram/0040/00456/1005T/1/Katajanokan term./17:36/null/5/60;24/19/65/90",
		},
		{
			name:  "truncated topic names no stop",
			topic: "/hfp/v2/journey/ongoing/vp/tram/0040/00456",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, eol := parseNextStop(strings.Split(tc.topic, "/"))
			if eol != tc.eol {
				t.Errorf("eol: expected %v, got %v", tc.eol, eol)
			}
			switch {
			case tc.want == "" && got != nil:
				t.Errorf("expected no next stop, got %q", *got)
			case tc.want != "" && (got == nil || *got != tc.want):
				t.Errorf("expected next stop %q, got %v", tc.want, got)
			}
		})
	}
}

// A vehicle waiting at a terminus republishes the same second and the same
// coordinate until it is given somewhere to go. The message that finally names
// the onward stop differs only in the topic, and dropping it as a duplicate
// would leave the map pointing at the stop the vehicle is standing on.
func TestIngestionWorker_NextStopChangeIsNotADuplicate(t *testing.T) {
	counting := &countingCache{Cache: cache.NewMemoryCache()}
	worker := NewIngestionWorker("tls://mock:8883", counting)

	reading := func(nextStop string) *mockMessage {
		return &mockMessage{
			payload: []byte(`{"VP":{"desi":"9","dir":"1","oper":40,"veh":90,"tsi":1788630995,"spd":0,"hdg":225,"lat":60.203964,"long":24.9687,"oday":"2026-09-05","start":"20:54","route":"1009"}}`),
			topic:   "/hfp/v2/journey/ongoing/vp/tram/0040/00090/1009/1/Eiranranta/20:54/" + nextStop + "/5/60;24/29/06/3",
		}
	}

	worker.handleMessage(nil, reading("1230410"))
	worker.handleMessage(nil, reading("1230410"))
	if counting.writes != 1 {
		t.Fatalf("expected the repeat to be dropped, got %d writes", counting.writes)
	}

	worker.handleMessage(nil, reading("1230411"))
	if counting.writes != 2 {
		t.Errorf("expected the new next stop to be stored, got %d writes", counting.writes)
	}
}

// HFP counts seconds ahead of schedule; everything downstream counts seconds
// behind it.
func TestNormalizeDelay(t *testing.T) {
	if got := normalizeDelay(-120); got != 120 {
		t.Errorf("two minutes late should read +120, got %d", got)
	}
	if got := normalizeDelay(59); got != -59 {
		t.Errorf("running early should read negative, got %d", got)
	}
	if got := normalizeDelay(0); got != 0 {
		t.Errorf("on time should read 0, got %d", got)
	}
}

// A tram reaching the live cache must also reach the archive, carrying the
// values the map was shown rather than the raw feed: the next stop parsed off
// the topic, the delay in the sign convention the rest of the app uses.
func TestIngestionWorker_RecordsToArchive(t *testing.T) {
	archive, err := replay.Open(replay.Config{Root: t.TempDir(), RetentionDays: 7, Modes: []string{"tram"}})
	if err != nil {
		t.Fatalf("Open archive: %v", err)
	}
	defer archive.Close()

	worker := NewIngestionWorker("tls://mock:8883", cache.NewMemoryCache())
	worker.SetArchive(archive)

	ts := time.Now().Add(-time.Minute).Truncate(time.Second)
	payload := fmt.Sprintf(`{"VP":{"desi":"9","dir":"1","oper":22,"veh":229,"tsi":%d,
		"spd":8.5,"hdg":145,"lat":60.16985,"long":24.93848,"acc":0.12,"dl":-15,
		"odo":12456,"drst":1,"oday":"2026-06-15","start":"09:15","stop":"HSL:1203420",
		"route":"HSL:1009","occu":0}}`, ts.Unix())

	worker.handleMessage(nil, &mockMessage{
		payload: []byte(payload),
		topic:   "/hfp/v2/journey/ongoing/vp/tram/22/229/HSL:1009/1/Jätkäsaari/09:15/HSL:1203420/14/60.17/24.94",
	})

	res, err := archive.Read(replay.Query{From: ts.Add(-time.Minute), To: ts.Add(time.Minute)})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(res.Samples) != 1 {
		t.Fatalf("archive holds %d readings, want 1", len(res.Samples))
	}

	got := res.Samples[0]
	if got.Veh != "22-229" || got.Desi != "9" || got.Mode != "tram" {
		t.Errorf("identity: %+v", got)
	}
	if math.Abs(got.Lat-60.16985) > 1e-5 || math.Abs(got.Lng-24.93848) > 1e-5 {
		t.Errorf("coordinate: got %.5f,%.5f", got.Lat, got.Lng)
	}
	if got.Dl != 15 {
		t.Errorf("delay: got %d, want 15 — the archive stores the normalized sign", got.Dl)
	}
	if got.NextStop == nil || *got.NextStop != "HSL:1203420" {
		t.Errorf("next stop off the topic: %v", got.NextStop)
	}
	if got.Drst != 1 {
		t.Errorf("door state: got %d, want 1", got.Drst)
	}
}

// Buses are ingested only while somebody is watching them, so recording them
// would produce a history with holes. The archive is told which modes it keeps
// and the ingestion path must respect that.
func TestIngestionWorker_DoesNotArchiveUnrecordedModes(t *testing.T) {
	root := t.TempDir()
	archive, err := replay.Open(replay.Config{Root: root, RetentionDays: 7, Modes: []string{"tram"}})
	if err != nil {
		t.Fatalf("Open archive: %v", err)
	}
	defer archive.Close()

	worker := NewIngestionWorker("tls://mock:8883", cache.NewMemoryCache())
	worker.SetArchive(archive)

	ts := time.Now().Add(-time.Minute).Truncate(time.Second)
	payload := fmt.Sprintf(`{"VP":{"desi":"550","dir":"1","oper":12,"veh":99,"tsi":%d,
		"spd":8.5,"hdg":145,"lat":60.2,"long":24.9,"oday":"2026-06-15","start":"09:15",
		"route":"HSL:2550"}}`, ts.Unix())

	worker.handleMessage(nil, &mockMessage{
		payload: []byte(payload),
		topic:   "/hfp/v2/journey/ongoing/vp/bus/12/99/HSL:2550/1/Itäkeskus/09:15/HSL:1203420/14/60.2/24.9",
	})

	res, err := archive.Read(replay.Query{From: ts.Add(-time.Minute), To: ts.Add(time.Minute)})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(res.Samples) != 0 {
		t.Fatalf("a bus was archived: %+v", res.Samples)
	}
}
