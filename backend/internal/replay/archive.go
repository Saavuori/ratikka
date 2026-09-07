package replay

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Helsinki is the zone the archive is filed in. Days are the unit a user
// scrubs through ("yesterday evening"), and a day boundary that moves with the
// viewer's own zone would put one evening in two directories.
var Helsinki = mustLoadHelsinki()

func mustLoadHelsinki() *time.Location {
	loc, err := time.LoadLocation("Europe/Helsinki")
	if err != nil {
		// Alpine images without tzdata; UTC files the archive in the wrong
		// place but keeps it working, which is the better failure.
		log.Printf("replay: Europe/Helsinki unavailable (%v), filing the archive in UTC\n", err)
		return time.UTC
	}
	return loc
}

// chunkSpan is how much time one file holds. A minute is small enough that the
// player can fetch exactly what it is about to show, and large enough that a
// week is ten thousand files rather than six hundred thousand.
const chunkSpan = time.Minute

// writerIdleSpan is how far behind the newest reading a chunk may fall before
// it is closed. HFP timestamps arrive a second or two out of order around a
// minute boundary, so the previous minute stays open long enough to take them.
const writerIdleSpan = 2 * time.Minute

// Position is one reading as the ingestion path hands it over — the same
// numbers the live cache is given, before anything is interned or packed.
type Position struct {
	Veh      string
	Desi     string
	Route    string
	Dir      string
	Oday     string
	Start    string
	TripID   string
	Mode     string
	Lat      float64
	Lng      float64
	Hdg      int
	Spd      float64
	Acc      float64
	Dl       int
	Drst     int
	AtStop   bool
	NextStop string
	EOL      bool
	Ts       int64
	Odo      *float64
	Oper     *int
	Jrn      *int
	Occu     *int
}

// Config configures the archive.
type Config struct {
	// Root is the directory the archive lives in. Empty disables recording
	// entirely, which is the default: an instance with no writable volume must
	// not quietly fill its container's layer.
	Root string
	// RetentionDays is how many days back are kept. Days older than this are
	// deleted whole.
	RetentionDays int
	// Modes are the vehicle modes recorded. Only trams are recorded by default,
	// because trams are the only mode ingested unconditionally — a bus history
	// would have holes wherever nobody happened to be watching buses.
	Modes []string
}

// Archive records readings into per-minute packed chunks and reads them back.
// The zero value is unusable; construct with Open.
type Archive struct {
	root      string
	retention time.Duration
	modes     map[string]bool

	mu      sync.Mutex
	writers map[string]*chunkWriter
	dicts   map[string]*dict
}

type chunkWriter struct {
	file    *os.File
	buf     *bufio.Writer
	minute  time.Time
	day     string
	records int
}

// Open prepares an archive rooted at cfg.Root. A configuration with no root
// returns a nil archive, which every method tolerates, so the caller does not
// have to branch on whether recording is switched on.
func Open(cfg Config) (*Archive, error) {
	if cfg.Root == "" {
		return nil, nil
	}
	if err := os.MkdirAll(cfg.Root, 0o755); err != nil {
		return nil, fmt.Errorf("replay: create archive root: %w", err)
	}

	modes := make(map[string]bool, len(cfg.Modes))
	for _, m := range cfg.Modes {
		modes[m] = true
	}
	if len(modes) == 0 {
		modes["tram"] = true
	}
	retention := time.Duration(cfg.RetentionDays) * 24 * time.Hour
	if retention <= 0 {
		retention = 7 * 24 * time.Hour
	}

	return &Archive{
		root:      cfg.Root,
		retention: retention,
		modes:     modes,
		writers:   make(map[string]*chunkWriter),
		dicts:     make(map[string]*dict),
	}, nil
}

// Enabled reports whether readings are being recorded.
func (a *Archive) Enabled() bool { return a != nil }

// Records reports whether a mode is one this archive keeps.
func (a *Archive) Records(mode string) bool {
	if a == nil {
		return false
	}
	return a.modes[mode]
}

// RetentionDays is how far back the archive reaches, for the index endpoint.
func (a *Archive) RetentionDays() int {
	if a == nil {
		return 0
	}
	return int(a.retention / (24 * time.Hour))
}

// Modes lists the recorded modes, sorted, for the index endpoint.
func (a *Archive) Modes() []string {
	if a == nil {
		return nil
	}
	out := make([]string, 0, len(a.modes))
	for m := range a.modes {
		out = append(out, m)
	}
	sort.Strings(out)
	return out
}

// Record appends one reading. It is called from the MQTT receive goroutines,
// which paho dispatches concurrently, so the whole append is serialised — the
// work under the lock is an intern lookup and a buffered write, both nanoseconds
// against the ~80 readings a second trams produce.
func (a *Archive) Record(pos Position) error {
	if a == nil || !a.modes[pos.Mode] || pos.Ts == 0 {
		return nil
	}

	ts := time.Unix(pos.Ts, 0).In(Helsinki)
	minute := ts.Truncate(chunkSpan)
	day := minute.Format("2006-01-02")

	a.mu.Lock()
	defer a.mu.Unlock()

	d, err := a.dictLocked(day)
	if err != nil {
		return err
	}

	journeyIdx, ok := d.internJourney(Journey{
		Veh: pos.Veh, Desi: pos.Desi, Route: pos.Route, Dir: pos.Dir,
		Oday: pos.Oday, Start: pos.Start, TripID: pos.TripID, Mode: pos.Mode,
		Oper: pos.Oper, Jrn: pos.Jrn,
	})
	if !ok {
		// The day has more journeys than a 16-bit reference can name. Dropping
		// the reading is the honest outcome; filing it under journey 0 would
		// attribute it to an unrelated vehicle.
		return nil
	}

	reading := Reading{
		Journey:  journeyIdx,
		TsDelta:  uint16(clampInt(int(ts.Sub(minute)/time.Second), 0, int(chunkSpan/time.Second)-1)),
		Lat:      pos.Lat,
		Lng:      pos.Lng,
		Spd:      pos.Spd,
		Acc:      pos.Acc,
		Hdg:      pos.Hdg,
		Dl:       pos.Dl,
		NextStop: d.internStop(pos.NextStop),
		Doors:    pos.Drst == 1,
		EOL:      pos.EOL,
		AtStop:   pos.AtStop,
	}
	if pos.Odo != nil {
		reading.Odo, reading.HasOdo = *pos.Odo, true
	}
	if pos.Occu != nil {
		reading.Occu, reading.HasOccu = *pos.Occu, true
	}

	var buf [RecordSize]byte
	if err := reading.Encode(buf[:]); err != nil {
		return err
	}

	w, err := a.writerLocked(day, minute, pos.Mode)
	if err != nil {
		return err
	}
	if _, err := w.buf.Write(buf[:]); err != nil {
		return fmt.Errorf("replay: write reading: %w", err)
	}
	w.records++

	a.closeIdleLocked(minute)
	RecordedCounter.WithLabelValues(pos.Mode).Inc()
	return nil
}

func (a *Archive) dictLocked(day string) (*dict, error) {
	if d, ok := a.dicts[day]; ok {
		return d, nil
	}
	dayDir := filepath.Join(a.root, day)
	if err := os.MkdirAll(dayDir, 0o755); err != nil {
		return nil, fmt.Errorf("replay: create day directory: %w", err)
	}
	d, err := loadDict(dayDir)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("replay: could not read %s dictionary (%v), starting a new one\n", day, err)
		}
		d = newDict()
	}
	a.dicts[day] = d
	return d, nil
}

func (a *Archive) writerLocked(day string, minute time.Time, mode string) (*chunkWriter, error) {
	path := chunkPath(a.root, day, minute, mode)
	if w, ok := a.writers[path]; ok {
		return w, nil
	}

	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("replay: open chunk: %w", err)
	}
	w := &chunkWriter{file: file, buf: bufio.NewWriterSize(file, 16*1024), minute: minute, day: day}
	a.writers[path] = w
	return w, nil
}

// closeIdleLocked closes chunks the feed has moved past. Their buffers are
// flushed on the way out, so a closed minute is complete on disk.
func (a *Archive) closeIdleLocked(now time.Time) {
	for path, w := range a.writers {
		if now.Sub(w.minute) < writerIdleSpan {
			continue
		}
		if err := w.close(); err != nil {
			log.Printf("replay: closing chunk %s: %v\n", path, err)
		}
		delete(a.writers, path)
	}
}

func (w *chunkWriter) close() error {
	if err := w.buf.Flush(); err != nil {
		w.file.Close()
		return err
	}
	return w.file.Close()
}

// Flush pushes buffered readings to the filesystem and rewrites any dictionary
// that has grown, so a reader — or a crash — sees everything up to the last
// flush. Called on a ticker; the exposure between flushes is seconds.
func (a *Archive) Flush() error {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	var firstErr error
	for path, w := range a.writers {
		if err := w.buf.Flush(); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("replay: flush %s: %w", path, err)
		}
	}
	for day, d := range a.dicts {
		if err := d.save(filepath.Join(a.root, day)); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// Close flushes and releases every open chunk. Safe to call twice.
func (a *Archive) Close() error {
	if a == nil {
		return nil
	}
	err := a.Flush()

	a.mu.Lock()
	defer a.mu.Unlock()
	for path, w := range a.writers {
		if cerr := w.close(); cerr != nil && err == nil {
			err = cerr
		}
		delete(a.writers, path)
	}
	return err
}

// Sweep deletes days that have fallen out of the retention window, and reports
// how many bytes the archive now occupies.
func (a *Archive) Sweep() (int64, error) {
	if a == nil {
		return 0, nil
	}
	entries, err := os.ReadDir(a.root)
	if err != nil {
		return 0, fmt.Errorf("replay: read archive root: %w", err)
	}

	cutoff := time.Now().In(Helsinki).Add(-a.retention).Truncate(24 * time.Hour)
	var total int64

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		day, err := time.ParseInLocation("2006-01-02", entry.Name(), Helsinki)
		if err != nil {
			continue // not one of ours; leave it alone
		}
		dayDir := filepath.Join(a.root, entry.Name())
		if day.Before(cutoff) {
			a.mu.Lock()
			delete(a.dicts, entry.Name())
			a.mu.Unlock()
			if err := os.RemoveAll(dayDir); err != nil {
				log.Printf("replay: could not delete expired day %s: %v\n", entry.Name(), err)
				continue
			}
			log.Printf("replay: deleted expired day %s\n", entry.Name())
			continue
		}
		total += dirSize(dayDir)
	}

	ArchiveBytesGauge.Set(float64(total))
	return total, nil
}

func dirSize(dir string) int64 {
	var total int64
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	for _, entry := range entries {
		if info, err := entry.Info(); err == nil {
			total += info.Size()
		}
	}
	return total
}

// chunkPath is where one minute of one mode lives: 2026-09-06/1436-tram.bin.
func chunkPath(root, day string, minute time.Time, mode string) string {
	return filepath.Join(root, day, fmt.Sprintf("%02d%02d-%s.bin", minute.Hour(), minute.Minute(), mode))
}

// parseChunkName reads a chunk filename back into the minute and mode it holds.
func parseChunkName(name string) (hour, minute int, mode string, ok bool) {
	if !strings.HasSuffix(name, ".bin") {
		return 0, 0, "", false
	}
	base := strings.TrimSuffix(name, ".bin")
	dash := strings.IndexByte(base, '-')
	if dash != 4 {
		return 0, 0, "", false
	}
	hour, err := strconv.Atoi(base[0:2])
	if err != nil || hour < 0 || hour > 23 {
		return 0, 0, "", false
	}
	minute, err = strconv.Atoi(base[2:4])
	if err != nil || minute < 0 || minute > 59 {
		return 0, 0, "", false
	}
	mode = base[dash+1:]
	if mode == "" {
		return 0, 0, "", false
	}
	return hour, minute, mode, true
}
