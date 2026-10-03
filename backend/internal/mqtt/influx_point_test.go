package mqtt

import (
	"strings"
	"testing"
)

func TestInfluxLine(t *testing.T) {
	stop, next := "HSL:1020450", "HSL:1020452"
	odo, occu, jrn := 12345.5, 0, 4567
	junction := 301
	pos := VehiclePosition{
		Veh: "0040-456", Desi: "4", Route: "1004", Dir: "1", Mode: "tram",
		Lat: 60.17, Lng: 24.94, Hdg: 187, Spd: 8.42, Acc: -0.31, Dl: 45, Drst: 1,
		Stop: &stop, NextStop: &next, Ts: 1720000000,
		TripId: "HSL:1004_20260615_Mo_1_0915", Start: "09:15",
		Odo: &odo, Occu: &occu, Jrn: &jrn,
		Hw:  &Headway{Ahead: "0040-412", Secs: 95, Sched: 360, State: HeadwayBunched},
		Tlp: &SignalPriority{Status: TLPGranted, Junction: &junction, Level: "normal"},
	}

	line := string(influxLine(pos))

	tags, rest, _ := strings.Cut(line, " ")
	if tags != "vehicle_position,desi=4,dir=1,mode=tram,route=1004,veh=0040-456" {
		t.Errorf("tags = %s", tags)
	}
	if !strings.HasSuffix(line, " 1720000000") {
		t.Errorf("timestamp missing: %s", line)
	}
	for _, want := range []string{
		"lat=60.17", "speed=8.42", "acceleration=-0.31", "heading=187i",
		"delay=45i", "doors_open=true", "at_stop=true", "eol=false",
		`stop="HSL:1020450"`, `next_stop="HSL:1020452"`, `start="09:15"`,
		"odometer=12345.5", "occupancy=0i", "journey=4567i",
		"headway=95i", "headway_scheduled=360i", `headway_state="bunched"`, `headway_ahead="0040-412"`,
		`tlp_status="granted"`, "tlp_junction=301i",
	} {
		if !strings.Contains(rest, want) {
			t.Errorf("fields lack %s: %s", want, rest)
		}
	}
}

func TestInfluxLineBetweenStops(t *testing.T) {
	line := string(influxLine(VehiclePosition{
		Veh: "0040-456", Route: "HSL:1004", Mode: "tram", Lat: 60.17, Lng: 24.94, Ts: 1,
	}))
	if strings.Contains(line, `stop="`) || strings.Contains(line, "headway") || strings.Contains(line, "tlp_") {
		t.Errorf("absent values should be left out, not written empty: %s", line)
	}
	if !strings.Contains(line, "route=1004,") || !strings.Contains(line, "at_stop=false") {
		t.Errorf("got %s", line)
	}
}
