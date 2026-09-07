package replay

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// MaxSamples caps what one query may return, so a wide window or a generous box
// cannot ask the backend to marshal an unbounded response. The player asks for
// minutes at a time and stays far below it; a week-long timelapse of a junction
// lands around a hundred thousand.
const MaxSamples = 400_000

// Sample is one archived reading, rehydrated with the journey and stop it
// referenced. The JSON field names match the live `VehiclePosition` the
// WebSocket sends, so the frontend can hand a replayed vehicle to exactly the
// same map, popup and telemetry code as a live one.
type Sample struct {
	Veh      string   `json:"veh"`
	Desi     string   `json:"desi"`
	Lat      float64  `json:"lat"`
	Lng      float64  `json:"lng"`
	Hdg      int      `json:"hdg"`
	Spd      float64  `json:"spd"`
	Acc      float64  `json:"acc"`
	Dl       int      `json:"dl"`
	Drst     int      `json:"drst"`
	Route    string   `json:"route"`
	Stop     *string  `json:"stop"`
	NextStop *string  `json:"nextStop"`
	EOL      bool     `json:"eol,omitempty"`
	Ts       int64    `json:"ts"`
	TripID   string   `json:"tripId"`
	Mode     string   `json:"mode"`
	Odo      *float64 `json:"odo,omitempty"`
	Oper     *int     `json:"oper,omitempty"`
	Jrn      *int     `json:"jrn,omitempty"`
	Occu     *int     `json:"occu,omitempty"`
	Dir      string   `json:"dir,omitempty"`
	Oday     string   `json:"oday,omitempty"`
	Start    string   `json:"start,omitempty"`
}

// BBox is a geographic filter, in degrees.
type BBox struct {
	West, South, East, North float64
}

func (b BBox) contains(lat, lng float64) bool {
	return lat >= b.South && lat <= b.North && lng >= b.West && lng <= b.East
}

// Query describes what to read out of the archive.
type Query struct {
	From  time.Time
	To    time.Time
	Modes []string
	// BBox, when set, keeps only readings inside it. This is the timelapse
	// filter, and it is what the packed layout exists for: the scan reads eight
	// bytes per reading to decide, and decodes the other twenty only for hits.
	BBox *BBox
	// Limit caps the samples returned. Zero means MaxSamples.
	Limit int
	// Step thins the result to at most one reading per journey per Step
	// seconds. Playback at sixty times real time does not need sixty readings
	// a second of every tram — it needs the same number of *drawn* steps as
	// playback at one times, covering sixty times as much ground. Thinning
	// here rather than in the browser is what keeps a fast timelapse to the
	// bandwidth of a slow one. Zero or one keeps everything.
	Step int
}

// thinKey identifies one journey on one day, for Query.Step.
type thinKey struct {
	day     string
	journey uint16
}

// Result is a query's samples plus what had to be left out.
type Result struct {
	Samples []Sample `json:"samples"`
	// Truncated reports that the limit was reached and later readings in the
	// window are missing, so the caller can narrow rather than silently show a
	// partial picture.
	Truncated bool `json:"truncated"`
	// Scanned is how many readings the query walked, hits and misses together.
	Scanned int `json:"scanned"`
}

// Read answers a query. Chunks are visited in time order, so the samples come
// back sorted by timestamp and the player can consume them as a stream.
func (a *Archive) Read(q Query) (Result, error) {
	var res Result
	if a == nil {
		return res, nil
	}
	if !q.To.After(q.From) {
		return res, nil
	}

	limit := q.Limit
	if limit <= 0 || limit > MaxSamples {
		limit = MaxSamples
	}
	modes := q.Modes
	if len(modes) == 0 {
		modes = a.Modes()
	}

	// Everything buffered has to reach the filesystem first, or the newest
	// minute — the one a player catching up on "just now" is asking for — reads
	// back short.
	if err := a.Flush(); err != nil {
		return res, err
	}

	step := q.Step
	kept := make(map[thinKey]int64)

	from := q.From.In(Helsinki)
	to := q.To.In(Helsinki)

	for minute := from.Truncate(chunkSpan); !minute.After(to); minute = minute.Add(chunkSpan) {
		day := minute.Format("2006-01-02")
		d, err := a.readDict(day)
		if err != nil {
			continue // no readings filed for this day at all
		}

		for _, mode := range modes {
			chunk, err := os.ReadFile(chunkPath(a.root, day, minute, mode))
			if err != nil {
				continue // a minute with no readings is normal, not an error
			}

			count := len(chunk) / RecordSize
			res.Scanned += count
			base := minute.Unix()

			for i := range count {
				// The bounding box is tested before anything is decoded: this
				// is the one comparison a timelapse query makes on the ~49 M
				// readings it rejects.
				if q.BBox != nil {
					lat, lng, ok := LatLngAt(chunk, i)
					if !ok || !q.BBox.contains(lat, lng) {
						continue
					}
				}

				reading, err := DecodeReading(chunk[i*RecordSize:])
				if err != nil {
					break // a torn tail on the minute currently being written
				}
				ts := base + int64(reading.TsDelta)
				if ts < from.Unix() || ts > to.Unix() {
					continue
				}
				if step > 1 {
					// Journey references are per-day, so a key that survives
					// midnight needs the day in it too.
					key := thinKey{day: day, journey: reading.Journey}
					if last, seen := kept[key]; seen && ts-last < int64(step) {
						continue
					}
					kept[key] = ts
				}
				if len(res.Samples) >= limit {
					res.Truncated = true
					return res, nil
				}
				res.Samples = append(res.Samples, sampleOf(reading, ts, d))
			}
		}
	}

	sort.SliceStable(res.Samples, func(i, j int) bool { return res.Samples[i].Ts < res.Samples[j].Ts })
	return res, nil
}

func sampleOf(r Reading, ts int64, d *dict) Sample {
	journey, _ := d.journey(r.Journey)

	s := Sample{
		Veh: journey.Veh, Desi: journey.Desi, Route: journey.Route,
		TripID: journey.TripID, Mode: journey.Mode, Dir: journey.Dir,
		Oday: journey.Oday, Start: journey.Start, Oper: journey.Oper, Jrn: journey.Jrn,
		Lat: r.Lat, Lng: r.Lng, Hdg: r.Hdg, Spd: r.Spd, Acc: r.Acc, Dl: r.Dl,
		EOL: r.EOL, Ts: ts,
	}
	if r.Doors {
		s.Drst = 1
	}
	if stop := d.stop(r.NextStop); stop != "" {
		next := stop
		s.NextStop = &next
		// A vehicle standing at a stop is standing at the one it was heading
		// for, so the two fields share an identity; see the ingestion notes.
		if r.AtStop {
			at := stop
			s.Stop = &at
		}
	}
	if r.HasOdo {
		odo := r.Odo
		s.Odo = &odo
	}
	if r.HasOccu {
		occu := r.Occu
		s.Occu = &occu
	}
	return s
}

// readDict returns a day's dictionary, preferring the live one the recorder is
// still adding to over the copy on disk.
func (a *Archive) readDict(day string) (*dict, error) {
	a.mu.Lock()
	if d, ok := a.dicts[day]; ok {
		a.mu.Unlock()
		return d, nil
	}
	a.mu.Unlock()
	return loadDict(filepath.Join(a.root, day))
}

// DayCoverage is what the archive holds for one day: how many minutes of
// readings landed in each hour, per mode. It is deliberately coarse — the
// timeline needs to know where the gaps are, not to enumerate ten thousand
// minutes.
type DayCoverage struct {
	Date string `json:"date"`
	// Hours maps mode to a 24-entry array of minutes recorded in that hour.
	Hours map[string][24]int `json:"hours"`
}

// Coverage reports what can be replayed, newest day first.
func (a *Archive) Coverage() ([]DayCoverage, error) {
	if a == nil {
		return nil, nil
	}
	entries, err := os.ReadDir(a.root)
	if err != nil {
		return nil, fmt.Errorf("replay: read archive root: %w", err)
	}

	var days []DayCoverage
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if _, err := time.ParseInLocation("2006-01-02", entry.Name(), Helsinki); err != nil {
			continue
		}

		files, err := os.ReadDir(filepath.Join(a.root, entry.Name()))
		if err != nil {
			continue
		}
		hours := make(map[string][24]int)
		for _, f := range files {
			hour, _, mode, ok := parseChunkName(f.Name())
			if !ok {
				continue
			}
			if info, err := f.Info(); err != nil || info.Size() < RecordSize {
				continue // an empty chunk is a minute with nothing in it
			}
			counts := hours[mode]
			counts[hour]++
			hours[mode] = counts
		}
		if len(hours) == 0 {
			continue
		}
		days = append(days, DayCoverage{Date: entry.Name(), Hours: hours})
	}

	sort.Slice(days, func(i, j int) bool { return days[i].Date > days[j].Date })
	return days, nil
}
