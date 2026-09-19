package mqtt

import (
	"sort"
	"sync"
	"time"
)

// Headways: how far each vehicle is running behind the one in front of it.
//
// A tram that is five minutes late is an inconvenience. Two trams of the same
// line running nose to tail are a different failure, and the commoner one: the
// one in front picks up everyone who has gathered at each stop, dwells longer,
// falls further behind, and the one behind it — finding its stops already
// emptied — catches up. The rider sees two 4s arrive together and then nothing
// for fifteen minutes. The timetable says every six. Neither vehicle's own
// delay says any of that; only the pair does.
//
// So this is measured, not estimated. Every vehicle names the stop it is
// heading for on every message (see parseNextStop), and the moment that name
// changes is the moment it left the stop. Recording when each vehicle left each
// stop gives, for the next vehicle of the same line and direction to leave it,
// the one number a rider waiting there actually experienced: how long after the
// previous one it came.
//
// What the gap *should* be comes from the same two passages. Each vehicle
// reports how late it is, so each passage also says when that vehicle was due
// at the stop: its departure minus its delay. The difference between the two
// due times is the pair's timetabled spacing, at that stop, whichever variant
// of the route either is running and wherever it started — which the trips'
// start times alone could not give for a short working that joins the line
// half way along.
//
// Judging a gap against the pair's own timetable would miss the worst case,
// though. A cancelled trip leaves its neighbours due twelve minutes apart
// instead of six, and they then run exactly to that timetable — twelve minutes
// apart, "on time", while the stop sees a twelve-minute hole. So each line's
// spacings are pooled and the median taken, and a gap is judged against that:
// what the line is running every, not what this pair is due at.
//
// Between stops the measurement is a stop old, and one bound tightens it: the
// vehicle in front left the stop this one is heading for some time ago, and
// this one has not got there yet — so the gap is at least that long. That
// bound only ever grows, which is what makes it useful: it is how a hole
// opening up is seen while the vehicle behind it is still crawling towards
// the next stop, rather than only once it gets there. But being a lower bound
// it can only ever show a gap. A vehicle whose trip has not passed a stop yet —
// one laying over at its terminus while the tram in front pulls out — may be
// seconds behind by the bound and depart on time regardless, so without a
// measurement nothing is claimed about it being close.

// Headway states, as sent to clients.
const (
	// HeadwayBunched: the vehicle is running so close behind the one ahead
	// that the two arrive together — within bunchedRatio of the line's
	// headway.
	HeadwayBunched = "bunched"
	// HeadwayGap: the vehicle is running well behind the one ahead, and the
	// stops between them are waiting for it.
	HeadwayGap = "gap"
	// HeadwayRegular: measured, and neither of the above.
	HeadwayRegular = "regular"
)

const (
	// bunchedRatio: a vehicle this close behind the one ahead, as a share of
	// the line's headway, is arriving with it rather than after it. A 6-minute
	// line bunches under 1 min 48 s; a 10-minute line under 3 minutes.
	bunchedRatio = 0.3
	// gapRatio and gapMinExcess: a gap has to be both proportionally large
	// and large in minutes. Proportion alone would flag a 2-minute metro
	// running 4 minutes apart, which nobody on the platform would call a gap.
	gapRatio     = 1.8
	gapMinExcess = 180 // seconds

	// headwayMaxGap is the furthest back a passage is taken as the vehicle in
	// front. Longer than any daytime headway HSL runs, and short enough that
	// the first tram of the morning is not measured against the last one of
	// the night before.
	headwayMaxGap = 60 * 60 // seconds

	// A line's headway is the median over the pairs running on it of what the
	// timetable spaces each pair at — one say per pair, however many stops it
	// happens to have passed lately. Pooling every passage instead lets
	// whichever pair is crossing the densest run of stops outvote the rest, and
	// on a long line around a timetable change that is one pair still on the
	// old frequency speaking for all of them.
	//
	// headwayPairSamples is how many stops a pair's own spacing is the median
	// of. A reported delay moves in steps rather than smoothly, so one stop's
	// reading can be a minute out; a few of them agree.
	headwayPairSamples = 5
	// headwayPairStale is how long a pair can go unmeasured before it stops
	// counting: a vehicle that has left the line without saying so.
	headwayPairStale = 20 * 60 // seconds
	// headwayMinPairs is how many pairs a line needs before its median is
	// trusted over the one pair's own timetable — and before one cancelled trip
	// is an outlier among them rather than the answer.
	headwayMinPairs = 3

	// headwayPassagesPerStop is how many recent passages each stop keeps. Only
	// the newest one before a given moment is ever the vehicle ahead; the
	// others absorb messages that arrive a little out of order.
	headwayPassagesPerStop = 4

	// headwayRunStale is how long a vehicle can go unheard and still be taken
	// to be where it last said it was.
	headwayRunStale = 2 * time.Minute
	// headwaySweepEvery is how often journeys and passages that have aged out
	// are swept, rather than on every message.
	headwaySweepEvery = time.Minute
)

// Headway is how far a vehicle is running behind the vehicle ahead of it on
// the same line and direction, as attached to its position.
type Headway struct {
	// Ahead is the vehicle key of the vehicle in front.
	Ahead string `json:"ahead"`
	// Secs is how far behind it this vehicle is running, in seconds.
	Secs int `json:"secs"`
	// AtLeast reports that Secs is a lower bound: the vehicle in front left
	// the stop this one is heading for that long ago, and this one has not
	// got there yet.
	AtLeast bool `json:"atLeast,omitempty"`
	// Sched is the line's timetabled headway around now, in seconds, or zero
	// when too little of the line has been seen to say.
	Sched int `json:"sched,omitempty"`
	// State is one of the Headway* constants, or empty when nothing can be
	// said: no timetable yet, or no measurement and no provable gap.
	State string `json:"state,omitempty"`
	// Stop is the stop Secs was measured at, when it was measured rather
	// than bounded.
	Stop string `json:"stop,omitempty"`
}

// headwayReading is what one position message contributes.
type headwayReading struct {
	veh   string
	route string
	dir   string
	oday  string
	start string
	// nextStop is the stop the vehicle is heading for, or "" where the feed
	// names none.
	nextStop string
	eol      bool
	// ts is the vehicle's own timestamp, in seconds. Every passage is timed
	// by the vehicle clocks, which HSL keeps on GPS time, so two vehicles'
	// passages can be subtracted.
	ts int64
	// dl is seconds late, positive late (see normalizeDelay).
	dl int
}

// headwayLine is one direction of one route. The two directions of a line
// share stops only at their termini, and a headway is only meaningful between
// vehicles going the same way.
type headwayLine struct {
	route string
	dir   string
}

type stopPassage struct {
	veh string
	ts  int64
	dl  int
}

// pairSpacing is the timetabled spacing between one vehicle and the vehicle
// ahead of it, over the last few stops both have left.
type pairSpacing struct {
	ahead  string
	recent []int
	// ts is when it was last measured, in vehicle time.
	ts int64
}

// lineHeadways is everything recorded for one direction of one line.
type lineHeadways struct {
	// passages holds the newest few departures from each stop.
	passages map[string][]stopPassage
	// pairs holds each vehicle's spacing to the one ahead of it, keyed by the
	// vehicle behind, and nominal is their median once there are enough.
	pairs   map[string]*pairSpacing
	nominal int
	// newest is the vehicle timestamp of the latest passage, for sweeping.
	newest int64
}

// vehicleRun is where one vehicle is up to on its current journey.
type vehicleRun struct {
	line headwayLine
	// trip is the journey's operating day and start time. A new one starts
	// the run over: a stop passed on the last journey says nothing about
	// this one.
	trip     string
	nextStop string
	// passed holds the stops this journey has already left.
	passed map[string]bool
	// last is the newest headway measured at a stop on this journey.
	last *headwayMeasurement
	seen time.Time
}

type headwayMeasurement struct {
	ahead string
	stop  string
	secs  int
	// sched is this pair's own timetabled spacing at the stop.
	sched int
}

// headwayTracker records stop passages and answers headways. It is written and
// read from the MQTT receive goroutines, which paho runs concurrently, so every
// access takes the mutex.
type headwayTracker struct {
	mu        sync.Mutex
	lines     map[headwayLine]*lineHeadways
	runs      map[string]*vehicleRun
	lastSweep time.Time
}

func newHeadwayTracker() *headwayTracker {
	return &headwayTracker{
		lines: make(map[headwayLine]*lineHeadways),
		runs:  make(map[string]*vehicleRun),
	}
}

// observe records one position and returns the vehicle's headway, or nil when
// there is none to give: the journey is unidentified, has reached the end of
// its line, or has nothing running ahead of it.
func (t *headwayTracker) observe(r headwayReading, now time.Time) *Headway {
	if r.route == "" || r.dir == "" || r.start == "" {
		return nil
	}
	key := headwayLine{route: r.route, dir: r.dir}
	trip := r.oday + "/" + r.start

	t.mu.Lock()
	defer t.mu.Unlock()
	t.sweep(now)

	line := t.lines[key]
	if line == nil {
		line = &lineHeadways{
			passages: make(map[string][]stopPassage),
			pairs:    make(map[string]*pairSpacing),
		}
		t.lines[key] = line
	}

	run := t.runs[r.veh]
	if run == nil || run.line != key || run.trip != trip {
		if run != nil {
			// Onto another journey: its spacing on the last one is no longer
			// part of how that line is running.
			t.dropPair(run.line, r.veh, r.ts)
		}
		run = &vehicleRun{line: key, trip: trip, passed: make(map[string]bool)}
		t.runs[r.veh] = run
	}
	run.seen = now

	// A stop this journey has already left is not one it can be heading for.
	// Taking the feed at its word there would record the stop it *is* heading
	// for as passed, and then pass the old one a second time.
	next := r.nextStop
	if run.passed[next] {
		next = ""
	}

	// The stop it was heading for is no longer the one it is heading for:
	// it has just left it. Reaching the end of the line is leaving the last.
	if run.nextStop != "" && (r.eol || (next != "" && next != run.nextStop)) {
		t.pass(line, run, r.veh, run.nextStop, r.ts, r.dl)
	}
	if r.eol {
		run.nextStop = ""
		line.dropPair(r.veh, r.ts)
		return nil
	}
	if next != "" {
		run.nextStop = next
	}
	return t.headway(line, run, r.veh, r.ts, now)
}

// pass records a vehicle leaving a stop, and measures it against the vehicle
// that left the same stop before it.
func (t *headwayTracker) pass(line *lineHeadways, run *vehicleRun, veh, stop string, ts int64, dl int) {
	run.passed[stop] = true
	passages := line.passages[stop]
	if ahead, ok := passageAhead(passages, veh, ts); ok {
		secs := int(ts - ahead.ts)
		// When each of the two was due here is its departure less its delay;
		// the difference is the spacing the timetable gave the pair.
		sched := secs - (dl - ahead.dl)
		run.last = &headwayMeasurement{ahead: ahead.veh, stop: stop, secs: secs, sched: sched}
		if sched > 0 && sched <= headwayMaxGap {
			line.addSpacing(veh, ahead.veh, ts, sched)
		}
	}

	if len(passages) >= headwayPassagesPerStop {
		copy(passages, passages[1:])
		passages = passages[:headwayPassagesPerStop-1]
	}
	line.passages[stop] = append(passages, stopPassage{veh: veh, ts: ts, dl: dl})
	if ts > line.newest {
		line.newest = ts
	}
}

// headway answers how far the vehicle is behind the one ahead of it, from its
// newest measurement and the bound its next stop puts on it.
func (t *headwayTracker) headway(line *lineHeadways, run *vehicleRun, veh string, ts int64, now time.Time) *Headway {
	m := run.last
	var hw *Headway
	boundOnly := false

	if run.nextStop == "" {
		if m == nil {
			return nil
		}
		hw = &Headway{Ahead: m.ahead, Secs: m.secs, Stop: m.stop}
	} else {
		p, passed := passageAhead(line.passages[run.nextStop], veh, ts)
		bound := int(ts - p.ts)
		switch {
		case m != nil && t.stillHeadingFor(m.ahead, run.line, run.nextStop, now):
			// Both are still running to the same stop, so nothing can have
			// come between them since the measurement — and the stop's own
			// newest passage belongs to whoever is in front of *them*.
			hw = &Headway{Ahead: m.ahead, Secs: m.secs, Stop: m.stop}
		case passed && m != nil && p.veh == m.ahead:
			hw = &Headway{Ahead: m.ahead, Secs: m.secs, Stop: m.stop}
			if bound > hw.Secs {
				hw.Secs = bound
				hw.AtLeast = true
			}
		case passed:
			// Unmeasured on this journey, or the vehicle it was measured
			// against has since left the line or been overtaken. The last
			// one through the next stop is the one ahead now, and the time
			// since it went through is all that is known.
			hw = &Headway{Ahead: p.veh, Secs: bound, AtLeast: true}
			boundOnly = true
		case m != nil:
			hw = &Headway{Ahead: m.ahead, Secs: m.secs, Stop: m.stop}
		default:
			return nil
		}
	}

	hw.Sched = line.nominal
	if hw.Sched == 0 && m != nil && m.ahead == hw.Ahead && m.sched > 0 {
		// Too little of the line seen yet to pool; the pair's own timetable
		// is the next best thing.
		hw.Sched = m.sched
	}
	hw.State = classifyHeadway(hw.Secs, hw.Sched, boundOnly)
	return hw
}

// dropPair takes a vehicle's spacing out of a line's headway, if the line is
// still being tracked.
func (t *headwayTracker) dropPair(key headwayLine, veh string, ts int64) {
	if line := t.lines[key]; line != nil {
		line.dropPair(veh, ts)
	}
}

// stillHeadingFor reports whether a vehicle is, as far as the tracker knows,
// still running on the same line towards the same stop.
func (t *headwayTracker) stillHeadingFor(veh string, line headwayLine, stop string, now time.Time) bool {
	run := t.runs[veh]
	return run != nil && run.line == line && run.nextStop == stop && now.Sub(run.seen) <= headwayRunStale
}

// classifyHeadway judges a gap against the line's headway. A bound can prove a
// gap but never that two vehicles are close, so a bound alone that is not a gap
// says nothing.
func classifyHeadway(secs, sched int, boundOnly bool) string {
	if sched <= 0 {
		return ""
	}
	if float64(secs) >= gapRatio*float64(sched) && secs-sched >= gapMinExcess {
		return HeadwayGap
	}
	if boundOnly {
		return ""
	}
	if float64(secs) <= bunchedRatio*float64(sched) {
		return HeadwayBunched
	}
	return HeadwayRegular
}

// passageAhead finds the vehicle that left a stop most recently before ts,
// other than veh itself — which a loop route can bring past the same stop twice.
func passageAhead(passages []stopPassage, veh string, ts int64) (stopPassage, bool) {
	var best stopPassage
	found := false
	for _, p := range passages {
		if p.veh == veh || p.ts > ts || ts-p.ts > headwayMaxGap {
			continue
		}
		if !found || p.ts > best.ts {
			best, found = p, true
		}
	}
	return best, found
}

// addSpacing records the timetabled spacing between a vehicle and the one
// ahead of it at a stop both have now left. A different vehicle ahead is a
// different pair, and starts its spacing afresh.
func (l *lineHeadways) addSpacing(veh, ahead string, ts int64, secs int) {
	p := l.pairs[veh]
	if p == nil || p.ahead != ahead {
		p = &pairSpacing{ahead: ahead}
		l.pairs[veh] = p
	}
	p.recent = append(p.recent, secs)
	if len(p.recent) > headwayPairSamples {
		p.recent = append(p.recent[:0], p.recent[len(p.recent)-headwayPairSamples:]...)
	}
	p.ts = ts
	l.updateNominal(ts)
}

// dropPair stops a vehicle's spacing counting towards the line's headway,
// once it has run off the end of the line or onto another journey.
func (l *lineHeadways) dropPair(veh string, ts int64) {
	if _, ok := l.pairs[veh]; !ok {
		return
	}
	delete(l.pairs, veh)
	l.updateNominal(ts)
}

// updateNominal takes the line's headway afresh: each pair's own spacing, then
// the median across the pairs.
func (l *lineHeadways) updateNominal(ts int64) {
	spacings := make([]int, 0, len(l.pairs))
	for veh, p := range l.pairs {
		if ts-p.ts > headwayPairStale {
			delete(l.pairs, veh)
			continue
		}
		spacings = append(spacings, median(p.recent))
	}
	if len(spacings) < headwayMinPairs {
		l.nominal = 0
		return
	}
	l.nominal = median(spacings)
}

// median is the middle value, the upper of the two for an even count.
func median(values []int) int {
	sorted := append([]int(nil), values...)
	sort.Ints(sorted)
	return sorted[len(sorted)/2]
}

// sweep drops journeys that have gone quiet and lines that have not moved in
// longer than any headway. Called with the mutex held.
func (t *headwayTracker) sweep(now time.Time) {
	if now.Sub(t.lastSweep) < headwaySweepEvery {
		return
	}
	t.lastSweep = now

	// A vehicle that has simply gone quiet keeps its pair until the pair goes
	// stale (headwayPairStale): quiet is not the same as gone.
	for veh, run := range t.runs {
		if now.Sub(run.seen) > dedupeTTL {
			delete(t.runs, veh)
		}
	}
	cutoff := now.Unix() - headwayMaxGap
	for key, line := range t.lines {
		if line.newest != 0 && line.newest < cutoff {
			delete(t.lines, key)
		}
	}
}
