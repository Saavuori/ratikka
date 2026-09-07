package replay

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// maxDictEntries is the ceiling the uint16 reference in a record imposes. Trams
// run roughly 3,000 journeys and touch some 1,500 stops in a day, so the
// headroom is twentyfold; a day that somehow exceeded it stops interning rather
// than wrapping a reference round onto somebody else's journey.
const maxDictEntries = 1 << 16

// Journey is everything about a run that does not change between its readings:
// which vehicle, which line, which direction, which departure. Roughly 1,700
// readings share one of these, which is why they are stored once and referenced
// by index.
type Journey struct {
	Veh    string `json:"veh"`
	Desi   string `json:"desi"`
	Route  string `json:"route"`
	Dir    string `json:"dir"`
	Oday   string `json:"oday"`
	Start  string `json:"start"`
	TripID string `json:"tripId"`
	Mode   string `json:"mode"`
	Oper   *int   `json:"oper,omitempty"`
	Jrn    *int   `json:"jrn,omitempty"`
}

func (j Journey) key() string {
	return j.Veh + "|" + j.Route + "|" + j.Dir + "|" + j.Oday + "|" + j.Start
}

// dict is one day's shared strings. Stop index 0 is always the empty sentinel,
// so a record's nextStop of 0 reads as "the feed named none" without needing a
// separate flag.
type dict struct {
	mu       sync.RWMutex
	Journeys []Journey `json:"journeys"`
	Stops    []string  `json:"stops"`

	journeyIndex map[string]uint16
	stopIndex    map[string]uint16
	dirty        bool
	full         bool
}

func newDict() *dict {
	return &dict{
		Stops:        []string{""},
		journeyIndex: make(map[string]uint16),
		stopIndex:    map[string]uint16{"": 0},
	}
}

// internJourney returns the index for a journey, adding it if new. The second
// result is false once the day has run out of references, which is the caller's
// cue to drop the reading rather than mislabel it.
func (d *dict) internJourney(j Journey) (uint16, bool) {
	key := j.key()

	d.mu.RLock()
	if idx, ok := d.journeyIndex[key]; ok {
		d.mu.RUnlock()
		return idx, true
	}
	d.mu.RUnlock()

	d.mu.Lock()
	defer d.mu.Unlock()
	if idx, ok := d.journeyIndex[key]; ok {
		return idx, true
	}
	if len(d.Journeys) >= maxDictEntries {
		d.full = true
		return 0, false
	}
	idx := uint16(len(d.Journeys))
	d.Journeys = append(d.Journeys, j)
	d.journeyIndex[key] = idx
	d.dirty = true
	return idx, true
}

// internStop returns the index for a stop ID. An unknown stop in a full
// dictionary degrades to 0 ("none stated") rather than dropping the reading:
// the position is still worth having without it.
func (d *dict) internStop(id string) uint16 {
	if id == "" {
		return 0
	}

	d.mu.RLock()
	if idx, ok := d.stopIndex[id]; ok {
		d.mu.RUnlock()
		return idx
	}
	d.mu.RUnlock()

	d.mu.Lock()
	defer d.mu.Unlock()
	if idx, ok := d.stopIndex[id]; ok {
		return idx
	}
	if len(d.Stops) >= maxDictEntries {
		d.full = true
		return 0
	}
	idx := uint16(len(d.Stops))
	d.Stops = append(d.Stops, id)
	d.stopIndex[id] = idx
	d.dirty = true
	return idx
}

func (d *dict) journey(idx uint16) (Journey, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if int(idx) >= len(d.Journeys) {
		return Journey{}, false
	}
	return d.Journeys[idx], true
}

func (d *dict) stop(idx uint16) string {
	if idx == 0 {
		return ""
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	if int(idx) >= len(d.Stops) {
		return ""
	}
	return d.Stops[idx]
}

func dictPath(dayDir string) string { return filepath.Join(dayDir, "dict.json") }

type storedDict struct {
	Journeys []Journey `json:"journeys"`
	Stops    []string  `json:"stops"`
}

// save rewrites the dictionary if anything has been added since the last write.
// It is written whole rather than appended to because it is small — a day of
// trams is a few hundred kilobytes — and the rename is atomic, so a crash
// mid-write cannot leave chunks pointing at a dictionary that will not parse.
func (d *dict) save(dayDir string) error {
	d.mu.Lock()
	if !d.dirty {
		d.mu.Unlock()
		return nil
	}
	payload, err := json.Marshal(storedDict{Journeys: d.Journeys, Stops: d.Stops})
	d.dirty = false
	d.mu.Unlock()

	if err != nil {
		return fmt.Errorf("marshal dictionary: %w", err)
	}

	tmp := dictPath(dayDir) + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o644); err != nil {
		return fmt.Errorf("write dictionary: %w", err)
	}
	return os.Rename(tmp, dictPath(dayDir))
}

func loadDict(dayDir string) (*dict, error) {
	payload, err := os.ReadFile(dictPath(dayDir))
	if err != nil {
		return nil, err
	}
	var stored storedDict
	if err := json.Unmarshal(payload, &stored); err != nil {
		return nil, fmt.Errorf("parse dictionary: %w", err)
	}

	d := newDict()
	d.Journeys = stored.Journeys
	if len(stored.Stops) > 0 {
		d.Stops = stored.Stops
	}
	for i, j := range d.Journeys {
		d.journeyIndex[j.key()] = uint16(i)
	}
	for i, s := range d.Stops {
		d.stopIndex[s] = uint16(i)
	}
	return d, nil
}
