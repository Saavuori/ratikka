package mqtt

import (
	"strings"

	"ratikka/internal/influx"
)

// influxMeasurement holds one point per accepted reading — after dedupe and
// after coupled units are paired down, so it holds what the live map showed,
// at the feed's own one-second resolution.
//
// Tags are what dashboards group and filter by, and are kept to identities
// that stay few: a tram carries the same handful of lines and two directions
// for months. Anything per-journey (trip, start time) or per-reading (stops)
// is a field, because as a tag every journey would open a new series and the
// index would grow without bound.
const influxMeasurement = "vehicle_position"

// SetInflux wires the InfluxDB writer that receives every accepted reading.
// Call once before Start. Nil — the default — writes nothing.
func (w *IngestionWorker) SetInflux(iw *influx.Writer) { w.influx = iw }

// writeInflux queues the reading for InfluxDB. Like the archive, it is fed
// after the cache write and its failures never reach the live map.
func (w *IngestionWorker) writeInflux(pos VehiclePosition) {
	if !w.influx.Records(pos.Mode) {
		return
	}
	w.influx.Write(influxLine(pos))
}

// influxLine renders a reading as a line-protocol point. Units are those of
// the HFP feed: metres per second, metres per second squared, degrees,
// metres; delay and headways in seconds, delay positive when late.
func influxLine(pos VehiclePosition) []byte {
	l := influx.NewLine(influxMeasurement).
		Tag("desi", pos.Desi).
		Tag("dir", pos.Dir).
		Tag("mode", pos.Mode).
		Tag("route", strings.TrimPrefix(pos.Route, "HSL:")).
		Tag("veh", pos.Veh)

	l.Float("lat", pos.Lat).
		Float("lng", pos.Lng).
		Int("heading", int64(pos.Hdg)).
		Float("speed", pos.Spd).
		Float("acceleration", pos.Acc).
		Int("delay", int64(pos.Dl)).
		Bool("doors_open", pos.Drst != 0).
		Bool("at_stop", pos.Stop != nil).
		Bool("eol", pos.Eol).
		String("trip_id", pos.TripId).
		String("start", pos.Start)

	if pos.Stop != nil {
		l.String("stop", *pos.Stop)
	}
	if pos.NextStop != nil {
		l.String("next_stop", *pos.NextStop)
	}
	if pos.Odo != nil {
		l.Float("odometer", *pos.Odo)
	}
	if pos.Occu != nil {
		l.Int("occupancy", int64(*pos.Occu))
	}
	if pos.Loc != nil {
		l.String("loc_source", *pos.Loc)
	}
	if pos.Oper != nil {
		l.Int("operator", int64(*pos.Oper))
	}
	if pos.Jrn != nil {
		l.Int("journey", int64(*pos.Jrn))
	}

	if hw := pos.Hw; hw != nil {
		l.Int("headway", int64(hw.Secs)).
			Bool("headway_at_least", hw.AtLeast).
			String("headway_state", hw.State).
			String("headway_ahead", hw.Ahead)
		if hw.Sched > 0 {
			l.Int("headway_scheduled", int64(hw.Sched))
		}
	}

	if tlp := pos.Tlp; tlp != nil {
		l.String("tlp_status", tlp.Status).
			String("tlp_level", tlp.Level).
			String("tlp_request_type", tlp.RequestType)
		if tlp.Junction != nil {
			l.Int("tlp_junction", int64(*tlp.Junction))
		}
	}

	return l.End(pos.Ts)
}
