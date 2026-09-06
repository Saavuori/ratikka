// Package replay keeps a rolling archive of vehicle positions on disk, so the
// map can be wound back through the last week instead of only showing now.
//
// The archive is deliberately not a database. Two things are ever asked of it:
// "give me every reading between these two instants", which is a sequential
// read, and "give me every reading inside this box over the last week", which
// is a full scan. Neither wants an index server, and both want the bytes to be
// cheap to walk — so a reading is a fixed-width 28-byte record, and a week of
// trams is about 1.1 GB that the page cache is happy to hold resident. Scanning
// all of it for a bounding box is then memory-bandwidth work rather than
// parsing work: the same query against the equivalent NDJSON would be 2 GB of
// gzip and 49 million JSON documents.
//
// Everything that is not a number — the line, the trip, the operating day, the
// stop the vehicle is heading for — repeats on every one of the ~1,700 readings
// a single journey produces, so it is lifted out into per-day dictionaries and
// referenced by a 16-bit index. That is what gets a reading down to 28 bytes;
// stored inline it would be nearer 300.
package replay

import (
	"encoding/binary"
	"errors"
	"math"
)

// RecordSize is the width of one packed reading. Fixed width is the point: a
// reader can seek to record n, and a bounding-box scan can stride through
// coordinates without decoding anything else.
const RecordSize = 28

// coordScale converts degrees to the integer form stored in the record. A
// microdegree is about 11 cm of latitude, an order of magnitude finer than the
// GPS error on the vehicles themselves, and 60.2°/24.9° scaled by a million sit
// well inside int32.
const coordScale = 1e6

// Field offsets within a record. Written little-endian, which is native on both
// architectures we build for.
const (
	offJourney  = 0  // uint16: index into the day's journey dictionary
	offTsDelta  = 2  // uint16: seconds after the chunk's start minute
	offLat      = 4  // int32:  microdegrees
	offLng      = 8  // int32:  microdegrees
	offSpd      = 12 // uint16: cm/s
	offAcc      = 14 // int16:  cm/s²
	offHdg      = 16 // uint16: degrees
	offDl       = 18 // int16:  seconds behind schedule, clamped
	offOdo      = 20 // uint32: metres
	offNextStop = 24 // uint16: index into the day's stop dictionary, 0 = none
	offFlags    = 26 // uint8:  bit 0 doors open, bit 1 end of line, bit 2 at a stop
	offOccu     = 27 // uint8:  occupancy percent, 255 = not reported
)

// Flag bits packed into offFlags.
const (
	flagDoorsOpen = 1 << 0
	flagEOL       = 1 << 1
	// flagAtStop records that the payload named a stop the vehicle was standing
	// at. The stop's identity is not stored separately: when a vehicle is at a
	// stop it is by definition the one it was heading for, which nextStop
	// already holds. See the ingestion notes on HFP's `stop` field.
	flagAtStop = 1 << 2
)

// occuUnknown is stored when the feed reports no occupancy, which it usually
// does. 255 rather than 0 because 0% is a real, common answer.
const occuUnknown = 0xFF

// ErrShortRecord is returned when a buffer is too small to hold a record.
var ErrShortRecord = errors.New("replay: buffer shorter than one record")

// Reading is one vehicle position as the archive stores it: the numbers that
// change every second, plus indices into the day's dictionaries for everything
// that does not.
type Reading struct {
	Journey  uint16
	TsDelta  uint16
	Lat      float64
	Lng      float64
	Spd      float64
	Acc      float64
	Hdg      int
	Dl       int
	Odo      float64
	HasOdo   bool
	NextStop uint16
	Doors    bool
	EOL      bool
	AtStop   bool
	Occu     int
	HasOccu  bool
}

// Encode writes the reading into buf, which must be at least RecordSize long.
func (r Reading) Encode(buf []byte) error {
	if len(buf) < RecordSize {
		return ErrShortRecord
	}
	binary.LittleEndian.PutUint16(buf[offJourney:], r.Journey)
	binary.LittleEndian.PutUint16(buf[offTsDelta:], r.TsDelta)
	binary.LittleEndian.PutUint32(buf[offLat:], uint32(int32(math.Round(r.Lat*coordScale))))
	binary.LittleEndian.PutUint32(buf[offLng:], uint32(int32(math.Round(r.Lng*coordScale))))
	binary.LittleEndian.PutUint16(buf[offSpd:], uint16(clampInt(int(math.Round(r.Spd*100)), 0, math.MaxUint16)))
	binary.LittleEndian.PutUint16(buf[offAcc:], uint16(int16(clampInt(int(math.Round(r.Acc*100)), math.MinInt16, math.MaxInt16))))
	binary.LittleEndian.PutUint16(buf[offHdg:], uint16(clampInt(r.Hdg, 0, math.MaxUint16)))
	binary.LittleEndian.PutUint16(buf[offDl:], uint16(int16(clampInt(r.Dl, math.MinInt16, math.MaxInt16))))

	var odo uint32
	if r.HasOdo {
		odo = uint32(clampInt(int(math.Round(r.Odo)), 0, math.MaxUint32-1)) + 1 // 0 means "not reported"
	}
	binary.LittleEndian.PutUint32(buf[offOdo:], odo)
	binary.LittleEndian.PutUint16(buf[offNextStop:], r.NextStop)

	var flags byte
	if r.Doors {
		flags |= flagDoorsOpen
	}
	if r.EOL {
		flags |= flagEOL
	}
	if r.AtStop {
		flags |= flagAtStop
	}
	buf[offFlags] = flags

	occu := byte(occuUnknown)
	if r.HasOccu {
		occu = byte(clampInt(r.Occu, 0, 100))
	}
	buf[offOccu] = occu
	return nil
}

// DecodeReading reads a record back out of buf.
func DecodeReading(buf []byte) (Reading, error) {
	if len(buf) < RecordSize {
		return Reading{}, ErrShortRecord
	}
	flags := buf[offFlags]
	odo := binary.LittleEndian.Uint32(buf[offOdo:])
	occu := buf[offOccu]

	r := Reading{
		Journey:  binary.LittleEndian.Uint16(buf[offJourney:]),
		TsDelta:  binary.LittleEndian.Uint16(buf[offTsDelta:]),
		Lat:      float64(int32(binary.LittleEndian.Uint32(buf[offLat:]))) / coordScale,
		Lng:      float64(int32(binary.LittleEndian.Uint32(buf[offLng:]))) / coordScale,
		Spd:      float64(binary.LittleEndian.Uint16(buf[offSpd:])) / 100,
		Acc:      float64(int16(binary.LittleEndian.Uint16(buf[offAcc:]))) / 100,
		Hdg:      int(binary.LittleEndian.Uint16(buf[offHdg:])),
		Dl:       int(int16(binary.LittleEndian.Uint16(buf[offDl:]))),
		NextStop: binary.LittleEndian.Uint16(buf[offNextStop:]),
		Doors:    flags&flagDoorsOpen != 0,
		EOL:      flags&flagEOL != 0,
		AtStop:   flags&flagAtStop != 0,
	}
	if odo > 0 {
		r.Odo = float64(odo - 1)
		r.HasOdo = true
	}
	if occu != occuUnknown {
		r.Occu = int(occu)
		r.HasOccu = true
	}
	return r, nil
}

// LatLngAt reads only the coordinate of record i out of a chunk's bytes. This
// is the whole reason for the fixed-width format: a bounding-box scan touches
// eight bytes per reading and decodes nothing else.
func LatLngAt(chunk []byte, i int) (lat, lng float64, ok bool) {
	off := i * RecordSize
	if off+RecordSize > len(chunk) {
		return 0, 0, false
	}
	lat = float64(int32(binary.LittleEndian.Uint32(chunk[off+offLat:]))) / coordScale
	lng = float64(int32(binary.LittleEndian.Uint32(chunk[off+offLng:]))) / coordScale
	return lat, lng, true
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
