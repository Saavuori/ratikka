package api

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ratikka/internal/replay"
)

// maxWindowSpan is how much history one playback request may ask for. The
// player fetches the minutes it is about to show and prefetches the next few,
// so it never approaches this; the cap is here so a hand-written request cannot
// ask the backend to marshal a day of the network at once.
const maxWindowSpan = 15 * time.Minute

// maxTimelapseSpan is how much history a bounding-box request may cover. A box
// is what makes a long span affordable — a junction over a week is a hundred
// thousand readings out of forty-nine million — so it is allowed the whole
// retention window, and required to name a box to get it.
const maxTimelapseSpan = 8 * 24 * time.Hour

// maxTimelapseArea is the largest box a timelapse may cover, in square degrees.
// Roughly a fifth of a degree square, which comfortably contains the tram
// network; without it "the whole world for a week" is a valid request and an
// unaffordable one.
const maxTimelapseArea = 0.04

// SetArchive wires the replay archive the history endpoints read from. A nil
// archive leaves them reporting that replay is unavailable.
func (h *Handlers) SetArchive(a *replay.Archive) { h.archive = a }

// ReplayIndexResponse tells the client what there is to replay: which modes are
// recorded, how far back, and — per day and hour — how many minutes actually
// landed, so the timeline can draw its gaps rather than stalling in them.
type ReplayIndexResponse struct {
	Enabled       bool                 `json:"enabled"`
	Modes         []string             `json:"modes"`
	RetentionDays int                  `json:"retentionDays"`
	ServerTime    int64                `json:"serverTime"`
	Days          []replay.DayCoverage `json:"days"`
}

func (h *Handlers) ReplayIndex(w http.ResponseWriter, r *http.Request) {
	res := ReplayIndexResponse{
		Enabled:       h.archive.Enabled(),
		Modes:         h.archive.Modes(),
		RetentionDays: h.archive.RetentionDays(),
		ServerTime:    time.Now().Unix(),
	}

	if res.Enabled {
		days, err := h.archive.Coverage()
		if err != nil {
			http.Error(w, "could not read replay coverage", http.StatusInternalServerError)
			return
		}
		res.Days = days
	}

	w.Header().Set("Content-Type", "application/json")
	// Coverage grows a minute at a time, so a few seconds of staleness costs
	// nothing and spares the archive a directory walk per client.
	w.Header().Set("Cache-Control", "public, max-age=15")
	json.NewEncoder(w).Encode(res)
}

// ReplayWindowResponse is a slice of history: every reading between two
// instants, in timestamp order. The samples carry the same field names as the
// live WebSocket's vehicles, so the client hands them to the same map code.
type ReplayWindowResponse struct {
	From      int64           `json:"from"`
	To        int64           `json:"to"`
	Samples   []replay.Sample `json:"samples"`
	Truncated bool            `json:"truncated"`
	Scanned   int             `json:"scanned"`
}

// ReplayWindow serves playback: a short span of every recorded vehicle.
func (h *Handlers) ReplayWindow(w http.ResponseWriter, r *http.Request) {
	h.serveReplayQuery(w, r, false)
}

// ReplayTimelapse serves a place rather than a moment: a long span narrowed to
// a bounding box. This is the query the packed archive exists for.
func (h *Handlers) ReplayTimelapse(w http.ResponseWriter, r *http.Request) {
	h.serveReplayQuery(w, r, true)
}

func (h *Handlers) serveReplayQuery(w http.ResponseWriter, r *http.Request, boxed bool) {
	if !h.archive.Enabled() {
		http.Error(w, "replay is not enabled on this server", http.StatusServiceUnavailable)
		return
	}

	q := r.URL.Query()
	from, fromErr := strconv.ParseInt(q.Get("from"), 10, 64)
	to, toErr := strconv.ParseInt(q.Get("to"), 10, 64)
	if fromErr != nil || toErr != nil || to <= from {
		http.Error(w, "from and to must be Unix seconds with to after from", http.StatusBadRequest)
		return
	}

	span := time.Duration(to-from) * time.Second
	limit := maxWindowSpan
	if boxed {
		limit = maxTimelapseSpan
	}
	if span > limit {
		http.Error(w, "requested span is longer than this endpoint allows", http.StatusBadRequest)
		return
	}

	query := replay.Query{
		From:  time.Unix(from, 0),
		To:    time.Unix(to, 0),
		Modes: parseReplayModes(q.Get("modes")),
		Step:  parseStep(q.Get("step")),
	}

	if boxed {
		box, err := parseBBox(q.Get("bbox"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		query.BBox = box
	} else if raw := q.Get("bbox"); raw != "" {
		// A box on a playback request is a legitimate optimisation — only draw
		// what is on screen — but it is optional there, so a malformed one is
		// ignored rather than refused.
		if box, err := parseBBox(raw); err == nil {
			query.BBox = box
		}
	}

	kind := "window"
	if boxed {
		kind = "timelapse"
	}
	started := time.Now()
	res, err := h.archive.Read(query)
	replay.QueryDurationHistogram.WithLabelValues(kind).Observe(time.Since(started).Seconds())
	if err != nil {
		http.Error(w, "could not read replay archive", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	// History does not change once written, so a window that has already
	// finished is immutable and worth caching hard. A window running up to now
	// is still being appended to and is not.
	if time.Unix(to, 0).Before(time.Now().Add(-2 * time.Minute)) {
		w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}

	json.NewEncoder(w).Encode(ReplayWindowResponse{
		From:      from,
		To:        to,
		Samples:   res.Samples,
		Truncated: res.Truncated,
		Scanned:   res.Scanned,
	})
}

// maxStep bounds the thinning a client may ask for. Beyond a minute between
// readings a vehicle has crossed several stops and the playback stops being a
// recording of anything.
const maxStep = 60

// parseStep reads the seconds-between-readings thinning, clamped. Anything
// unparseable keeps every reading, which is the honest default.
func parseStep(raw string) int {
	step, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || step < 1 {
		return 1
	}
	if step > maxStep {
		return maxStep
	}
	return step
}

func parseReplayModes(raw string) []string {
	var modes []string
	for _, part := range strings.Split(raw, ",") {
		if mode := strings.TrimSpace(part); mode != "" {
			modes = append(modes, mode)
		}
	}
	return modes
}

// parseBBox reads a "west,south,east,north" box in degrees.
func parseBBox(raw string) (*replay.BBox, error) {
	parts := strings.Split(raw, ",")
	if len(parts) != 4 {
		return nil, errBadBBox
	}

	var v [4]float64
	for i, part := range parts {
		f, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil, errBadBBox
		}
		v[i] = f
	}

	box := &replay.BBox{West: v[0], South: v[1], East: v[2], North: v[3]}
	if !validCoordinates(box.South, box.West) || !validCoordinates(box.North, box.East) {
		return nil, errBadBBox
	}
	if box.East <= box.West || box.North <= box.South {
		return nil, errBadBBox
	}
	if (box.East-box.West)*(box.North-box.South) > maxTimelapseArea {
		return nil, errBBoxTooLarge
	}
	return box, nil
}

type replayError string

func (e replayError) Error() string { return string(e) }

const (
	errBadBBox      = replayError("bbox must be west,south,east,north in degrees")
	errBBoxTooLarge = replayError("bbox covers too much ground; zoom in and try again")
)
