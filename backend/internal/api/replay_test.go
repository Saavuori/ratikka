package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ratikka/internal/replay"
)

func replayHandlers(t *testing.T) (*Handlers, *replay.Archive) {
	t.Helper()
	archive, err := replay.Open(replay.Config{Root: t.TempDir(), RetentionDays: 7, Modes: []string{"tram"}})
	if err != nil {
		t.Fatalf("Open archive: %v", err)
	}
	t.Cleanup(func() { archive.Close() })

	h := NewHandlers(nil, nil, nil)
	h.SetArchive(archive)
	return h, archive
}

func recordTramMinute(t *testing.T, a *replay.Archive, base time.Time, lat, lng float64) {
	t.Helper()
	for i := range 60 {
		err := a.Record(replay.Position{
			Veh: "0040-456", Desi: "9", Route: "1009", Dir: "1",
			Oday: base.Format("2006-01-02"), Start: "17:36", Mode: "tram",
			TripID: "HSL:1009_x", Lat: lat, Lng: lng, Hdg: 90, Spd: 6,
			NextStop: "HSL:1020450", Ts: base.Add(time.Duration(i) * time.Second).Unix(),
		})
		if err != nil {
			t.Fatalf("Record: %v", err)
		}
	}
	if err := a.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}
}

func TestReplayIndexReportsCoverage(t *testing.T) {
	h, archive := replayHandlers(t)
	base := time.Now().In(replay.Helsinki).Truncate(time.Minute).Add(-time.Hour)
	recordTramMinute(t, archive, base, 60.17, 24.94)

	rec := httptest.NewRecorder()
	h.ReplayIndex(rec, httptest.NewRequest(http.MethodGet, "/api/v1/replay/index", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", rec.Code)
	}
	var res ReplayIndexResponse
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !res.Enabled || res.RetentionDays != 7 || len(res.Modes) != 1 || res.Modes[0] != "tram" {
		t.Fatalf("index: %+v", res)
	}
	if len(res.Days) != 1 {
		t.Fatalf("got %d days of coverage, want 1", len(res.Days))
	}
	if got := res.Days[0].Hours["tram"][base.Hour()]; got == 0 {
		t.Errorf("hour %d reports no minutes recorded", base.Hour())
	}
}

// Without an archive the endpoints have to say so, not pretend there is simply
// no history — the client shows a different thing in each case.
func TestReplayWithoutArchive(t *testing.T) {
	h := NewHandlers(nil, nil, nil)

	rec := httptest.NewRecorder()
	h.ReplayIndex(rec, httptest.NewRequest(http.MethodGet, "/api/v1/replay/index", nil))
	var res ReplayIndexResponse
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res.Enabled {
		t.Error("index reports replay enabled with no archive")
	}

	rec = httptest.NewRecorder()
	h.ReplayWindow(rec, httptest.NewRequest(http.MethodGet, "/api/v1/replay/window?from=1&to=2", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("window status %d, want 503", rec.Code)
	}
}

func TestReplayWindowReturnsSamples(t *testing.T) {
	h, archive := replayHandlers(t)
	base := time.Now().In(replay.Helsinki).Truncate(time.Minute).Add(-time.Hour)
	recordTramMinute(t, archive, base, 60.17, 24.94)

	url := fmt.Sprintf("/api/v1/replay/window?from=%d&to=%d", base.Unix(), base.Add(59*time.Second).Unix())
	rec := httptest.NewRecorder()
	h.ReplayWindow(rec, httptest.NewRequest(http.MethodGet, url, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", rec.Code, rec.Body)
	}
	var res ReplayWindowResponse
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(res.Samples) != 60 {
		t.Fatalf("got %d samples, want 60", len(res.Samples))
	}
	// The samples must be shaped exactly like live vehicles, or the map cannot
	// draw them with the code it already has.
	if res.Samples[0].Veh != "0040-456" || res.Samples[0].Desi != "9" || res.Samples[0].Mode != "tram" {
		t.Errorf("sample not shaped like a live vehicle: %+v", res.Samples[0])
	}
	// A window that finished long ago can never change, so it is cacheable.
	if cc := rec.Header().Get("Cache-Control"); cc == "" || cc == "no-store" {
		t.Errorf("a settled window should be cacheable, got %q", cc)
	}
}

// A window running up to now is still being written and must not be cached, or
// the player would replay a partial minute for a day.
func TestReplayWindowAtNowIsNotCached(t *testing.T) {
	h, archive := replayHandlers(t)
	now := time.Now().In(replay.Helsinki)
	recordTramMinute(t, archive, now.Truncate(time.Minute), 60.17, 24.94)

	url := fmt.Sprintf("/api/v1/replay/window?from=%d&to=%d", now.Add(-time.Minute).Unix(), now.Unix())
	rec := httptest.NewRecorder()
	h.ReplayWindow(rec, httptest.NewRequest(http.MethodGet, url, nil))

	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control %q, want no-store", got)
	}
}

func TestReplayWindowRejectsBadSpans(t *testing.T) {
	h, _ := replayHandlers(t)
	now := time.Now().Unix()

	for _, tc := range []struct{ name, query string }{
		{"missing bounds", ""},
		{"reversed", fmt.Sprintf("?from=%d&to=%d", now, now-60)},
		{"zero length", fmt.Sprintf("?from=%d&to=%d", now, now)},
		{"unparseable", "?from=soon&to=later"},
		{"longer than the cap", fmt.Sprintf("?from=%d&to=%d", now-3600, now)},
	} {
		rec := httptest.NewRecorder()
		h.ReplayWindow(rec, httptest.NewRequest(http.MethodGet, "/api/v1/replay/window"+tc.query, nil))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", tc.name, rec.Code)
		}
	}
}

func TestReplayTimelapseFiltersToBox(t *testing.T) {
	h, archive := replayHandlers(t)
	base := time.Now().In(replay.Helsinki).Truncate(time.Minute).Add(-2 * time.Hour)
	recordTramMinute(t, archive, base, 60.170, 24.940)
	recordTramMinute(t, archive, base.Add(time.Minute), 60.300, 25.100)

	url := fmt.Sprintf("/api/v1/replay/timelapse?from=%d&to=%d&bbox=24.93,60.16,24.95,60.18",
		base.Unix(), base.Add(2*time.Minute).Unix())
	rec := httptest.NewRecorder()
	h.ReplayTimelapse(rec, httptest.NewRequest(http.MethodGet, url, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", rec.Code, rec.Body)
	}
	var res ReplayWindowResponse
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(res.Samples) != 60 {
		t.Fatalf("got %d samples, want the 60 inside the box", len(res.Samples))
	}
	if res.Scanned != 120 {
		t.Errorf("scanned %d readings, want 120 — everything is walked, most rejected", res.Scanned)
	}
}

// A timelapse is only affordable because it is narrow. An unbounded or absurd
// box has to be refused rather than answered slowly.
func TestReplayTimelapseRequiresASaneBox(t *testing.T) {
	h, _ := replayHandlers(t)
	now := time.Now().Unix()

	for _, tc := range []struct{ name, bbox string }{
		{"absent", ""},
		{"too few parts", "24.9,60.1,24.95"},
		{"inverted", "24.95,60.18,24.93,60.16"},
		{"the whole world", "-180,-85,180,85"},
		{"not numbers", "west,south,east,north"},
	} {
		url := fmt.Sprintf("/api/v1/replay/timelapse?from=%d&to=%d&bbox=%s", now-3600, now, tc.bbox)
		rec := httptest.NewRecorder()
		h.ReplayTimelapse(rec, httptest.NewRequest(http.MethodGet, url, nil))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", tc.name, rec.Code)
		}
	}
}

// The timelapse span may reach across the whole retention window; the box is
// what pays for it.
func TestReplayTimelapseAllowsALongSpan(t *testing.T) {
	h, _ := replayHandlers(t)
	now := time.Now().Unix()
	url := fmt.Sprintf("/api/v1/replay/timelapse?from=%d&to=%d&bbox=24.93,60.16,24.95,60.18",
		now-7*24*3600, now)

	rec := httptest.NewRecorder()
	h.ReplayTimelapse(rec, httptest.NewRequest(http.MethodGet, url, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("a week-long boxed query was refused: %d %s", rec.Code, rec.Body)
	}
}
