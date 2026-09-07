package replay

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReadingRoundTrip(t *testing.T) {
	odo, occu := 12345.0, 42
	in := Reading{
		Journey: 1234, TsDelta: 47,
		Lat: 60.171234, Lng: 24.941234,
		Spd: 8.42, Acc: -0.31, Hdg: 187, Dl: -45,
		Odo: odo, HasOdo: true,
		NextStop: 77, Doors: true, EOL: false, AtStop: true,
		Occu: occu, HasOccu: true,
	}

	var buf [RecordSize]byte
	if err := in.Encode(buf[:]); err != nil {
		t.Fatalf("Encode: %v", err)
	}
	out, err := DecodeReading(buf[:])
	if err != nil {
		t.Fatalf("DecodeReading: %v", err)
	}

	// Coordinates survive to a microdegree, ~11 cm — an order of magnitude
	// finer than the GPS error on the vehicles.
	if math.Abs(out.Lat-in.Lat) > 1e-6 || math.Abs(out.Lng-in.Lng) > 1e-6 {
		t.Errorf("coordinate drifted: got %.6f,%.6f want %.6f,%.6f", out.Lat, out.Lng, in.Lat, in.Lng)
	}
	if math.Abs(out.Spd-in.Spd) > 0.01 || math.Abs(out.Acc-in.Acc) > 0.01 {
		t.Errorf("speed/acceleration drifted: got %.2f/%.2f want %.2f/%.2f", out.Spd, out.Acc, in.Spd, in.Acc)
	}
	if out.Journey != in.Journey || out.TsDelta != in.TsDelta || out.Hdg != in.Hdg || out.Dl != in.Dl {
		t.Errorf("integer fields differ: got %+v want %+v", out, in)
	}
	if !out.Doors || !out.AtStop || out.EOL {
		t.Errorf("flags differ: doors=%v atStop=%v eol=%v", out.Doors, out.AtStop, out.EOL)
	}
	if !out.HasOdo || out.Odo != odo {
		t.Errorf("odometer: got %v/%v want %v/true", out.Odo, out.HasOdo, odo)
	}
	if !out.HasOccu || out.Occu != occu {
		t.Errorf("occupancy: got %v/%v want %v/true", out.Occu, out.HasOccu, occu)
	}
}

// A reading with nothing optional reported must come back saying so, rather
// than claiming an odometer of zero and an empty vehicle.
func TestReadingOmitsUnreportedFields(t *testing.T) {
	var buf [RecordSize]byte
	if err := (Reading{Lat: 60.2, Lng: 24.9}).Encode(buf[:]); err != nil {
		t.Fatalf("Encode: %v", err)
	}
	out, err := DecodeReading(buf[:])
	if err != nil {
		t.Fatalf("DecodeReading: %v", err)
	}
	if out.HasOdo {
		t.Error("odometer reported when none was given")
	}
	if out.HasOccu {
		t.Error("occupancy reported when none was given")
	}
}

// Zero occupancy is a real answer — an empty tram — and must not be confused
// with the feed not saying.
func TestZeroOccupancyIsReported(t *testing.T) {
	var buf [RecordSize]byte
	if err := (Reading{Occu: 0, HasOccu: true}).Encode(buf[:]); err != nil {
		t.Fatalf("Encode: %v", err)
	}
	out, _ := DecodeReading(buf[:])
	if !out.HasOccu || out.Occu != 0 {
		t.Errorf("zero occupancy lost: got %v/%v", out.Occu, out.HasOccu)
	}
}

func TestRecordSizeIsStable(t *testing.T) {
	// A week of trams is ~49 M readings; the record width is what makes that
	// 1.1 GB rather than 15. Changing it invalidates every chunk on disk, so
	// it should never move by accident.
	if RecordSize != 28 {
		t.Fatalf("RecordSize changed to %d — existing archives can no longer be read", RecordSize)
	}
}

func testArchive(t *testing.T) (*Archive, string) {
	t.Helper()
	root := t.TempDir()
	a, err := Open(Config{Root: root, RetentionDays: 7, Modes: []string{"tram"}})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { a.Close() })
	return a, root
}

func samplePosition(ts time.Time, veh string, lat, lng float64) Position {
	odo := 1000.0
	return Position{
		Veh: veh, Desi: "9", Route: "1009", Dir: "1",
		Oday: ts.In(Helsinki).Format("2006-01-02"), Start: "17:36",
		TripID: "HSL:1009_20260906_Su_1_1736", Mode: "tram",
		Lat: lat, Lng: lng, Hdg: 180, Spd: 7.5, Acc: 0.1, Dl: 30,
		Drst: 1, AtStop: true, NextStop: "HSL:1020450",
		Ts: ts.Unix(), Odo: &odo,
	}
}

func TestArchiveRecordAndRead(t *testing.T) {
	a, _ := testArchive(t)
	base := time.Date(2026, 9, 6, 17, 36, 0, 0, Helsinki)

	for i := range 90 {
		pos := samplePosition(base.Add(time.Duration(i)*time.Second), "0040-456", 60.17+float64(i)*1e-4, 24.94)
		if err := a.Record(pos); err != nil {
			t.Fatalf("Record: %v", err)
		}
	}

	res, err := a.Read(Query{From: base, To: base.Add(90 * time.Second), Modes: []string{"tram"}})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(res.Samples) != 90 {
		t.Fatalf("got %d samples, want 90", len(res.Samples))
	}

	// Readings spanning a minute boundary must come back in order, from both
	// chunks, with the journey rehydrated off the day's dictionary.
	for i := 1; i < len(res.Samples); i++ {
		if res.Samples[i].Ts < res.Samples[i-1].Ts {
			t.Fatalf("samples out of order at %d: %d before %d", i, res.Samples[i-1].Ts, res.Samples[i].Ts)
		}
	}
	first := res.Samples[0]
	if first.Veh != "0040-456" || first.Desi != "9" || first.TripID != "HSL:1009_20260906_Su_1_1736" {
		t.Errorf("journey not rehydrated: %+v", first)
	}
	if first.Ts != base.Unix() {
		t.Errorf("timestamp: got %d want %d", first.Ts, base.Unix())
	}
	if first.NextStop == nil || *first.NextStop != "HSL:1020450" {
		t.Errorf("next stop not rehydrated: %v", first.NextStop)
	}
	if first.Stop == nil || *first.Stop != "HSL:1020450" {
		t.Errorf("a reading taken at a stop should name it: %v", first.Stop)
	}
	if first.Drst != 1 {
		t.Errorf("door state lost: %d", first.Drst)
	}
}

// The window is inclusive of its ends and excludes everything else, or the
// player would replay seconds either side of where the user put the scrubber.
func TestArchiveReadWindowsPrecisely(t *testing.T) {
	a, _ := testArchive(t)
	base := time.Date(2026, 9, 6, 17, 36, 0, 0, Helsinki)
	for i := range 60 {
		if err := a.Record(samplePosition(base.Add(time.Duration(i)*time.Second), "0040-456", 60.17, 24.94)); err != nil {
			t.Fatalf("Record: %v", err)
		}
	}

	res, err := a.Read(Query{From: base.Add(10 * time.Second), To: base.Add(19 * time.Second)})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(res.Samples) != 10 {
		t.Fatalf("got %d samples, want 10", len(res.Samples))
	}
	if res.Samples[0].Ts != base.Add(10*time.Second).Unix() {
		t.Errorf("window starts at %d, want %d", res.Samples[0].Ts, base.Add(10*time.Second).Unix())
	}
}

// The bounding-box filter is the timelapse query: it must keep what is inside
// the box and reject everything else, having scanned it all.
func TestArchiveBBoxFilter(t *testing.T) {
	a, _ := testArchive(t)
	base := time.Date(2026, 9, 6, 17, 36, 0, 0, Helsinki)

	inside := samplePosition(base, "0040-1", 60.170, 24.940)
	outside := samplePosition(base.Add(time.Second), "0040-2", 60.300, 25.100)
	if err := a.Record(inside); err != nil {
		t.Fatalf("Record: %v", err)
	}
	if err := a.Record(outside); err != nil {
		t.Fatalf("Record: %v", err)
	}

	box := &BBox{West: 24.93, South: 60.16, East: 24.95, North: 60.18}
	res, err := a.Read(Query{From: base, To: base.Add(time.Minute), BBox: box})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(res.Samples) != 1 || res.Samples[0].Veh != "0040-1" {
		t.Fatalf("bbox kept %d samples (%+v), want just the one inside", len(res.Samples), res.Samples)
	}
	if res.Scanned != 2 {
		t.Errorf("scanned %d readings, want 2 — the filter should reject, not skip", res.Scanned)
	}
}

func TestArchiveLimitTruncates(t *testing.T) {
	a, _ := testArchive(t)
	base := time.Date(2026, 9, 6, 17, 36, 0, 0, Helsinki)
	for i := range 30 {
		if err := a.Record(samplePosition(base.Add(time.Duration(i)*time.Second), "0040-456", 60.17, 24.94)); err != nil {
			t.Fatalf("Record: %v", err)
		}
	}

	res, err := a.Read(Query{From: base, To: base.Add(time.Minute), Limit: 5})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(res.Samples) != 5 || !res.Truncated {
		t.Fatalf("got %d samples truncated=%v, want 5 and truncated", len(res.Samples), res.Truncated)
	}
}

// Only recorded modes are written. Buses are ingested on demand, so a bus
// history would have holes wherever nobody was watching — better none at all.
func TestArchiveIgnoresUnrecordedModes(t *testing.T) {
	a, root := testArchive(t)
	base := time.Date(2026, 9, 6, 17, 36, 0, 0, Helsinki)

	bus := samplePosition(base, "0012-99", 60.17, 24.94)
	bus.Mode = "bus"
	if err := a.Record(bus); err != nil {
		t.Fatalf("Record: %v", err)
	}
	if err := a.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	if entries, _ := os.ReadDir(root); len(entries) != 0 {
		t.Fatalf("a bus reading created %v; only recorded modes should be written", entries)
	}
	if a.Records("bus") {
		t.Error("Records reports buses are archived when they are not")
	}
}

func TestArchiveCoverage(t *testing.T) {
	a, _ := testArchive(t)
	base := time.Date(2026, 9, 6, 17, 36, 0, 0, Helsinki)
	for i := range 3 {
		ts := base.Add(time.Duration(i) * time.Minute)
		if err := a.Record(samplePosition(ts, "0040-456", 60.17, 24.94)); err != nil {
			t.Fatalf("Record: %v", err)
		}
	}
	if err := a.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	days, err := a.Coverage()
	if err != nil {
		t.Fatalf("Coverage: %v", err)
	}
	if len(days) != 1 || days[0].Date != "2026-09-06" {
		t.Fatalf("coverage: %+v", days)
	}
	if got := days[0].Hours["tram"][17]; got != 3 {
		t.Errorf("hour 17 covers %d minutes, want 3", got)
	}
}

func TestArchiveSweepDropsExpiredDays(t *testing.T) {
	a, root := testArchive(t)

	stale := time.Now().In(Helsinki).AddDate(0, 0, -9)
	fresh := time.Now().In(Helsinki).Add(-2 * time.Hour)
	for _, ts := range []time.Time{stale, fresh} {
		if err := a.Record(samplePosition(ts, "0040-456", 60.17, 24.94)); err != nil {
			t.Fatalf("Record: %v", err)
		}
	}
	if err := a.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	if _, err := a.Sweep(); err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, stale.Format("2006-01-02"))); !os.IsNotExist(err) {
		t.Errorf("day outside retention survived the sweep (err=%v)", err)
	}
	if _, err := os.Stat(filepath.Join(root, fresh.Format("2006-01-02"))); err != nil {
		t.Errorf("day inside retention was deleted: %v", err)
	}
}

// A nil archive is what an instance with no writable volume gets. Every method
// has to tolerate it so callers do not branch on whether recording is on.
func TestNilArchiveIsInert(t *testing.T) {
	var a *Archive
	if a.Enabled() || a.Records("tram") || a.RetentionDays() != 0 || a.Modes() != nil {
		t.Error("a nil archive claims to be recording")
	}
	if err := a.Record(Position{Mode: "tram", Ts: 1}); err != nil {
		t.Errorf("Record on nil archive: %v", err)
	}
	res, err := a.Read(Query{From: time.Now(), To: time.Now().Add(time.Minute)})
	if err != nil || len(res.Samples) != 0 {
		t.Errorf("Read on nil archive: %+v %v", res, err)
	}
	if _, err := a.Sweep(); err != nil {
		t.Errorf("Sweep on nil archive: %v", err)
	}
	if err := a.Close(); err != nil {
		t.Errorf("Close on nil archive: %v", err)
	}
}

func TestParseChunkName(t *testing.T) {
	for _, tc := range []struct {
		name      string
		wantOK    bool
		hour, min int
		mode      string
	}{
		{name: "1436-tram.bin", wantOK: true, hour: 14, min: 36, mode: "tram"},
		{name: "0000-metro.bin", wantOK: true, hour: 0, min: 0, mode: "metro"},
		{name: "dict.json", wantOK: false},
		{name: "2536-tram.bin", wantOK: false},
		{name: "1436-.bin", wantOK: false},
	} {
		hour, min, mode, ok := parseChunkName(tc.name)
		if ok != tc.wantOK {
			t.Errorf("%s: ok=%v want %v", tc.name, ok, tc.wantOK)
			continue
		}
		if ok && (hour != tc.hour || min != tc.min || mode != tc.mode) {
			t.Errorf("%s: got %d:%d %s want %d:%d %s", tc.name, hour, min, mode, tc.hour, tc.min, tc.mode)
		}
	}
}

// Step thins a fast playback to the readings it can actually draw. Sixty times
// real time does not need sixty readings a second; it needs the same number of
// drawn steps covering sixty times the ground.
func TestArchiveStepThinsPerJourney(t *testing.T) {
	a, _ := testArchive(t)
	base := time.Date(2026, 9, 6, 17, 36, 0, 0, Helsinki)

	for i := range 60 {
		ts := base.Add(time.Duration(i) * time.Second)
		for _, veh := range []string{"0040-1", "0040-2"} {
			if err := a.Record(samplePosition(ts, veh, 60.17, 24.94)); err != nil {
				t.Fatalf("Record: %v", err)
			}
		}
	}

	res, err := a.Read(Query{From: base, To: base.Add(59 * time.Second), Step: 10})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	// Six readings apiece: one every ten seconds across a minute.
	if len(res.Samples) != 12 {
		t.Fatalf("got %d samples, want 12 (2 vehicles x 6 steps)", len(res.Samples))
	}
	if res.Scanned != 120 {
		t.Errorf("scanned %d, want 120 — thinning happens after the read, not before", res.Scanned)
	}

	seen := map[string][]int64{}
	for _, s := range res.Samples {
		seen[s.Veh] = append(seen[s.Veh], s.Ts)
	}
	for veh, timestamps := range seen {
		if len(timestamps) != 6 {
			t.Errorf("%s kept %d readings, want 6", veh, len(timestamps))
		}
		for i := 1; i < len(timestamps); i++ {
			if gap := timestamps[i] - timestamps[i-1]; gap < 10 {
				t.Errorf("%s: readings %ds apart, want at least 10", veh, gap)
			}
		}
	}
}

// Thinning must not drop a whole vehicle: every journey in the window keeps its
// own readings, however many others are in the same second.
func TestArchiveStepKeepsEveryJourney(t *testing.T) {
	a, _ := testArchive(t)
	base := time.Date(2026, 9, 6, 17, 36, 0, 0, Helsinki)

	for v := range 20 {
		if err := a.Record(samplePosition(base, fmt.Sprintf("0040-%d", v), 60.17, 24.94)); err != nil {
			t.Fatalf("Record: %v", err)
		}
	}

	res, err := a.Read(Query{From: base, To: base.Add(time.Minute), Step: 30})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(res.Samples) != 20 {
		t.Fatalf("got %d samples, want all 20 vehicles", len(res.Samples))
	}
}
