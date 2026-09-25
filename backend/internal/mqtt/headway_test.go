package mqtt

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"ratikka/internal/cache"
)

// report feeds the tracker one position on line 4 heading out (route 1004,
// direction 1), the way the feed would: the vehicle, its journey's start time,
// the stop it is heading for, its own timestamp and how late it is. The
// tracker's clock is the vehicle's, so staleness is measured in feed time.
func report(tr *headwayTracker, veh, start, nextStop string, ts int64, dl int) *Headway {
	return tr.observe(headwayReading{
		veh: veh, route: "1004", dir: "1", oday: "2026-09-19", start: start,
		nextStop: nextStop, ts: ts, dl: dl,
	}, time.Unix(ts, 0))
}

// leaves reports a vehicle heading for `from` and then, five seconds later,
// heading for `to` — which is how the feed says it left `from`.
func leaves(tr *headwayTracker, veh, start, from, to string, ts int64, dl int) *Headway {
	report(tr, veh, start, from, ts-5, dl)
	return report(tr, veh, start, to, ts, dl)
}

// A line running every five minutes, on time, for long enough that its
// headway is pooled rather than read off one pair.
func fiveMinuteLine(tr *headwayTracker, stop, next string, first int64) {
	for i := 0; i < 5; i++ {
		leaves(tr, fmt.Sprintf("0040-%d", 300+i), fmt.Sprintf("07:%02d", 30+5*i), stop, next,
			first+int64(300*i), 0)
	}
}

func TestHeadway_MeasuredWhenBothHaveLeftTheStop(t *testing.T) {
	tr := newHeadwayTracker()
	leaves(tr, "0040-401", "08:00", "S1", "S2", 1_000, 0)
	hw := leaves(tr, "0040-402", "08:06", "S1", "S2", 1_360, 0)

	if hw == nil {
		t.Fatal("expected a headway for the second tram through the stop")
	}
	if hw.Ahead != "0040-401" || hw.Secs != 360 || hw.Stop != "S1" || hw.AtLeast {
		t.Errorf("headway = %+v, want 360 s behind 0040-401, measured at S1", hw)
	}
	// Two trams are too few to pool: the pair's own timetable stands in.
	if hw.Sched != 360 || hw.State != HeadwayRegular {
		t.Errorf("sched/state = %d/%q, want 360/regular", hw.Sched, hw.State)
	}
}

// The first tram is five minutes late, the second on time: due six minutes
// apart, they left the stop one minute apart.
func TestHeadway_LateLeaderAndPunctualFollowerBunch(t *testing.T) {
	tr := newHeadwayTracker()
	leaves(tr, "0040-401", "08:00", "S1", "S2", 1_300, 300)
	hw := leaves(tr, "0040-402", "08:06", "S1", "S2", 1_360, 0)

	if hw == nil || hw.Secs != 60 {
		t.Fatalf("headway = %+v, want 60 s", hw)
	}
	if hw.Sched != 360 {
		t.Errorf("sched = %d, want the 360 s the timetable gave the pair", hw.Sched)
	}
	if hw.State != HeadwayBunched {
		t.Errorf("state = %q, want bunched", hw.State)
	}
}

// A cancelled trip leaves its neighbours due ten minutes apart on a
// five-minute line, and running exactly to that timetable. The pair is on
// time; the stop still waited ten minutes.
func TestHeadway_MissingTripIsAGapAgainstTheLine(t *testing.T) {
	tr := newHeadwayTracker()
	fiveMinuteLine(tr, "S1", "S2", 1_000)
	// The last of those left at 2_200; the next is due, and runs, at 2_800.
	hw := leaves(tr, "0040-410", "07:55", "S1", "S2", 2_800, 0)

	if hw == nil || hw.Secs != 600 {
		t.Fatalf("headway = %+v, want 600 s", hw)
	}
	if hw.Sched != 300 {
		t.Errorf("sched = %d, want the line's 300 s rather than the pair's 600", hw.Sched)
	}
	if hw.State != HeadwayGap {
		t.Errorf("state = %q, want gap", hw.State)
	}
}

// Between stops the gap is at least as long as it has been since the tram in
// front went through the next one — which is how a hole is seen opening before
// the tram behind it reaches that stop.
func TestHeadway_BoundShowsAGapOpeningBetweenStops(t *testing.T) {
	tr := newHeadwayTracker()
	fiveMinuteLine(tr, "S1", "S2", 1_000)
	leaves(tr, "0040-401", "08:00", "S1", "S2", 3_000, 0)
	leaves(tr, "0040-402", "08:05", "S1", "S2", 3_300, 0)
	leaves(tr, "0040-401", "08:00", "S2", "S3", 3_100, 0)

	// Tram 402 is held somewhere short of S2, eleven minutes after 401 left it.
	hw := report(tr, "0040-402", "08:05", "S2", 3_760, 0)
	if hw == nil {
		t.Fatal("expected a headway")
	}
	if hw.Ahead != "0040-401" || hw.Secs != 660 || !hw.AtLeast {
		t.Errorf("headway = %+v, want at least 660 s behind 0040-401", hw)
	}
	if hw.State != HeadwayGap {
		t.Errorf("state = %q, want gap", hw.State)
	}
}

// Once the bound outgrows the gap measured at the last stop, the number is the
// bound, taken at the next stop, and it must not claim the last stop's name:
// the card would read "timed leaving S1" beside a figure S1 never timed.
func TestHeadway_BoundOverAMeasurementNamesNoStop(t *testing.T) {
	tr := newHeadwayTracker()
	fiveMinuteLine(tr, "S1", "S2", 1_000)
	leaves(tr, "0040-401", "08:00", "S1", "S2", 3_000, 0)
	leaves(tr, "0040-402", "08:05", "S1", "S2", 3_300, 0)
	leaves(tr, "0040-401", "08:00", "S2", "S3", 3_100, 0)

	// Still measured at S1 while the bound is shorter than the measurement.
	hw := report(tr, "0040-402", "08:05", "S2", 3_350, 0)
	if hw == nil || hw.Secs != 300 || hw.AtLeast || hw.Stop != "S1" {
		t.Fatalf("headway = %+v, want 300 s measured at S1", hw)
	}

	// Tram 402 keeps reporting, held short of S2 eleven minutes after 401
	// left it.
	for ts := int64(3_400); ts < 3_760; ts += 60 {
		report(tr, "0040-402", "08:05", "S2", ts, 0)
	}
	hw = report(tr, "0040-402", "08:05", "S2", 3_760, 0)
	if hw == nil || hw.Ahead != "0040-401" || hw.Secs != 660 || !hw.AtLeast {
		t.Fatalf("headway = %+v, want at least 660 s behind 0040-401", hw)
	}
	if hw.Stop != "" {
		t.Errorf("stop = %q, want none: 660 s is bounded at S2, not measured at S1", hw.Stop)
	}
	if hw.State != HeadwayGap {
		t.Errorf("state = %q, want gap", hw.State)
	}
}

// A tram laying over at its terminus while the one in front pulls out is
// seconds behind it by the bound, and will still leave on time. A bound says
// nothing about closeness.
func TestHeadway_BoundAloneNeverClaimsBunching(t *testing.T) {
	tr := newHeadwayTracker()
	fiveMinuteLine(tr, "S1", "S2", 1_000)
	leaves(tr, "0040-401", "08:00", "S1", "S2", 3_000, 0)
	hw := report(tr, "0040-402", "08:05", "S1", 3_030, 0)

	if hw == nil || hw.Secs != 30 || !hw.AtLeast {
		t.Fatalf("headway = %+v, want at least 30 s", hw)
	}
	if hw.State != "" {
		t.Errorf("state = %q, want none from a bound alone", hw.State)
	}
}

// Two trams nose to tail, both still running to the same stop: the newest
// passage of that stop belongs to whoever is in front of the pair, and must not
// replace the measurement between them.
func TestHeadway_BunchedPairHeadingForTheSameStopStaysMeasured(t *testing.T) {
	tr := newHeadwayTracker()
	leaves(tr, "0040-400", "07:54", "S1", "S2", 700, 0)
	leaves(tr, "0040-400", "07:54", "S2", "S3", 760, 0)
	leaves(tr, "0040-401", "08:00", "S1", "S2", 1_300, 300)
	leaves(tr, "0040-402", "08:06", "S1", "S2", 1_360, 0)

	report(tr, "0040-401", "08:00", "S2", 1_400, 300)
	hw := report(tr, "0040-402", "08:06", "S2", 1_401, 0)
	if hw == nil || hw.Ahead != "0040-401" || hw.Secs != 60 || hw.AtLeast {
		t.Fatalf("headway = %+v, want the 60 s measured behind 0040-401", hw)
	}
	if hw.State != HeadwayBunched {
		t.Errorf("state = %q, want bunched", hw.State)
	}
}

// Once the tram it was measured against has left the line, the one ahead is
// whoever last went through the next stop.
func TestHeadway_LeaderLeavingTheLineHandsOverToTheNextOneAhead(t *testing.T) {
	tr := newHeadwayTracker()
	leaves(tr, "0040-400", "07:54", "S1", "S2", 700, 0)
	leaves(tr, "0040-400", "07:54", "S2", "S3", 760, 0)
	leaves(tr, "0040-401", "08:00", "S1", "S2", 1_300, 0)
	leaves(tr, "0040-402", "08:06", "S1", "S2", 1_360, 0)

	// 401 is taken off the line: it signs on to another journey.
	report(tr, "0040-401", "08:30", "S9", 1_400, 0)
	hw := report(tr, "0040-402", "08:06", "S2", 1_401, 0)
	if hw == nil || hw.Ahead != "0040-400" || hw.Secs != 641 || !hw.AtLeast {
		t.Fatalf("headway = %+v, want at least 641 s behind 0040-400", hw)
	}
}

func TestHeadway_EndOfLineRecordsTheLastStopAndStops(t *testing.T) {
	tr := newHeadwayTracker()
	report(tr, "0040-401", "08:00", "S9", 1_000, 0)
	hw := tr.observe(headwayReading{
		veh: "0040-401", route: "1004", dir: "1", oday: "2026-09-19", start: "08:00",
		eol: true, ts: 1_060,
	}, time.Unix(1_060, 0))

	if hw != nil {
		t.Errorf("headway = %+v, want none at the end of the line", hw)
	}
	passages := tr.lines[headwayLine{route: "1004", dir: "1"}].passages["S9"]
	if len(passages) != 1 || passages[0].veh != "0040-401" || passages[0].ts != 1_060 {
		t.Errorf("passages at S9 = %+v, want 0040-401 leaving at 1060", passages)
	}
}

// A stop left on the last journey says nothing about where the vehicle is on
// this one.
func TestHeadway_NewJourneyStartsOver(t *testing.T) {
	tr := newHeadwayTracker()
	leaves(tr, "0040-401", "08:00", "S1", "S2", 1_000, 0)
	leaves(tr, "0040-402", "08:06", "S1", "S2", 1_360, 0)

	hw := report(tr, "0040-402", "09:10", "S2", 1_400, 0)
	if hw != nil {
		t.Errorf("headway = %+v, want none: nothing on this journey has been passed or run ahead", hw)
	}
}

func TestHeadwayTracker_SweepDropsLinesThatNeverPassedAStop(t *testing.T) {
	tr := newHeadwayTracker()
	// A vehicle whose feed never names a next stop: its line is created, but
	// nothing on it is ever passed.
	report(tr, "0040-401", "08:00", "", 1_000, 0)
	if len(tr.lines) != 1 {
		t.Fatalf("lines = %d, want 1", len(tr.lines))
	}

	tr.mu.Lock()
	tr.sweep(time.Unix(1_000+headwayMaxGap+1, 0))
	tr.mu.Unlock()
	if len(tr.lines) != 0 {
		t.Errorf("lines = %d after the sweep, want 0: an empty line lingered", len(tr.lines))
	}
}

func TestHeadway_DirectionsDoNotMix(t *testing.T) {
	tr := newHeadwayTracker()
	tr.observe(headwayReading{veh: "0040-401", route: "1004", dir: "2", oday: "2026-09-19", start: "08:00",
		nextStop: "S1", ts: 995}, time.Unix(995, 0))
	tr.observe(headwayReading{veh: "0040-401", route: "1004", dir: "2", oday: "2026-09-19", start: "08:00",
		nextStop: "S2", ts: 1_000}, time.Unix(1_000, 0))

	if hw := leaves(tr, "0040-402", "08:06", "S1", "S2", 1_360, 0); hw != nil {
		t.Errorf("headway = %+v, want none: the only tram through S1 was going the other way", hw)
	}
}

// The feed going back to a stop the journey already left is not the vehicle
// leaving the one it is heading for.
func TestHeadway_StopAlreadyLeftIsNotHeadedForAgain(t *testing.T) {
	tr := newHeadwayTracker()
	leaves(tr, "0040-401", "08:00", "S1", "S2", 1_000, 0)
	report(tr, "0040-401", "08:00", "S1", 1_010, 0)
	report(tr, "0040-401", "08:00", "S2", 1_020, 0)

	line := tr.lines[headwayLine{route: "1004", dir: "1"}]
	if got := line.passages["S2"]; len(got) != 0 {
		t.Errorf("passages at S2 = %+v, want none", got)
	}
	if got := line.passages["S1"]; len(got) != 1 {
		t.Errorf("passages at S1 = %+v, want the one departure", got)
	}
}

func TestHeadway_UnidentifiedJourneyHasNone(t *testing.T) {
	tr := newHeadwayTracker()
	if hw := tr.observe(headwayReading{veh: "0040-401", nextStop: "S1", ts: 1_000}, time.Unix(1_000, 0)); hw != nil {
		t.Errorf("headway = %+v, want none without a journey", hw)
	}
}

func TestClassifyHeadway(t *testing.T) {
	cases := []struct {
		name      string
		secs      int
		sched     int
		boundOnly bool
		want      string
	}{
		{"no timetable yet", 60, 0, false, ""},
		{"nose to tail", 90, 360, false, HeadwayBunched},
		{"just outside bunched", 120, 360, false, HeadwayRegular},
		{"double the headway", 720, 360, false, HeadwayGap},
		// Twice a two-minute metro headway is four minutes: proportionally a
		// gap, not one anyone on the platform would call it.
		{"short line, small excess", 240, 120, false, HeadwayRegular},
		{"bound proves a gap", 720, 360, true, HeadwayGap},
		{"bound proves nothing else", 30, 360, true, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyHeadway(tc.secs, tc.sched, tc.boundOnly); got != tc.want {
				t.Errorf("classifyHeadway(%d, %d, %v) = %q, want %q", tc.secs, tc.sched, tc.boundOnly, got, tc.want)
			}
		})
	}
}

func newLine() *lineHeadways {
	return &lineHeadways{passages: make(map[string][]stopPassage), pairs: make(map[string]*pairSpacing)}
}

// Each pair gets one say in the line's headway, however many stops it has
// crossed: one pair still on a ten-minute timetable, measured at stop after
// stop, does not outvote three running every twelve.
func TestLineHeadways_EachPairHasOneSay(t *testing.T) {
	l := newLine()
	for i := 0; i < 20; i++ {
		l.addSpacing("0040-401", "0040-400", int64(1_000+i*30), 600)
	}
	l.addSpacing("0040-402", "0040-401", 1_600, 720)
	l.addSpacing("0040-403", "0040-402", 1_600, 720)
	l.addSpacing("0040-404", "0040-403", 1_600, 720)

	if l.nominal != 720 {
		t.Errorf("nominal = %d, want 720", l.nominal)
	}
}

// A pair's own spacing is the median of its last few stops, so one reading a
// minute out — a delay that had not caught up yet — does not move it.
func TestLineHeadways_PairSpacingIsItsRecentMedian(t *testing.T) {
	l := newLine()
	for _, s := range []int{720, 780, 720, 660, 720, 300} {
		l.addSpacing("0040-401", "0040-400", 1_000, s)
	}
	if got := median(l.pairs["0040-401"].recent); got != 720 {
		t.Errorf("pair spacing = %d, want 720", got)
	}
}

func TestLineHeadways_TooFewPairsSayNothing(t *testing.T) {
	l := newLine()
	l.addSpacing("0040-401", "0040-400", 1_000, 720)
	l.addSpacing("0040-402", "0040-401", 1_000, 720)
	if l.nominal != 0 {
		t.Errorf("nominal = %d, want none from two pairs", l.nominal)
	}
}

// A pair not measured for a long while has left the line without saying so.
func TestLineHeadways_StalePairsStopCounting(t *testing.T) {
	l := newLine()
	for i, veh := range []string{"a", "b", "c"} {
		l.addSpacing(veh, fmt.Sprint(i), 1_000, 300)
	}
	later := int64(1_000 + headwayPairStale + 60)
	for i, veh := range []string{"d", "e", "f"} {
		l.addSpacing(veh, fmt.Sprint(i), later, 600)
	}
	if l.nominal != 600 || len(l.pairs) != 3 {
		t.Errorf("nominal = %d over %d pairs, want 600 over the 3 still running", l.nominal, len(l.pairs))
	}
}

// A vehicle that reaches the end of its line takes its pair out of the line's
// headway with it.
func TestHeadway_EndOfLineDropsThePair(t *testing.T) {
	tr := newHeadwayTracker()
	leaves(tr, "0040-401", "08:00", "S1", "S2", 1_000, 0)
	leaves(tr, "0040-402", "08:06", "S1", "S2", 1_360, 0)
	line := tr.lines[headwayLine{route: "1004", dir: "1"}]
	if _, ok := line.pairs["0040-402"]; !ok {
		t.Fatal("expected 0040-402's spacing to be recorded")
	}

	tr.observe(headwayReading{
		veh: "0040-402", route: "1004", dir: "1", oday: "2026-09-19", start: "08:06",
		eol: true, ts: 1_900,
	}, time.Unix(1_900, 0))
	if _, ok := line.pairs["0040-402"]; ok {
		t.Error("the pair should stop counting once its vehicle has run off the end of the line")
	}
}

// End to end: two trams of line 4 through the same stop, as the broker sends
// them, and the second one's cached position carries how far behind the first
// it is.
func TestIngestionWorker_PositionCarriesHeadway(t *testing.T) {
	memCache := cache.NewMemoryCache()
	worker := NewIngestionWorker("tls://mock:8883", memCache)

	send := func(veh int, start, nextStop string, tsi int64) {
		topic := fmt.Sprintf("/hfp/v2/journey/ongoing/vp/tram/0040/%05d/1004/1/Pikku Huopalahti/%s/%s/4/60;24/19/91/13",
			veh, start, nextStop)
		payload := fmt.Sprintf(`{"VP":{"desi":"4","dir":"1","oper":40,"veh":%d,"tsi":%d,"spd":5,"hdg":10,`+
			`"lat":60.17,"long":24.94,"dl":0,"oday":"2026-09-19","start":"%s","route":"1004"}}`, veh, tsi, start)
		worker.handleMessage(nil, &mockMessage{payload: []byte(payload), topic: topic})
	}
	send(401, "08:00", "1130106", 1_000)
	send(401, "08:00", "1130108", 1_010)
	send(402, "08:06", "1130106", 1_300)
	send(402, "08:06", "1130108", 1_370)

	positions, err := memCache.GetAllPositions(context.Background())
	if err != nil {
		t.Fatalf("GetAllPositions: %v", err)
	}
	raw, ok := positions["0040-402"]
	if !ok {
		t.Fatal("tram 402 missing from the cache")
	}
	var pos VehiclePosition
	if err := json.Unmarshal(raw, &pos); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if pos.Hw == nil {
		t.Fatal("expected the position to carry a headway")
	}
	if pos.Hw.Ahead != "0040-401" || pos.Hw.Secs != 360 || pos.Hw.Stop != "HSL:1130106" {
		t.Errorf("hw = %+v, want 360 s behind 0040-401 at HSL:1130106", pos.Hw)
	}
}
