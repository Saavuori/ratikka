package api

import (
	"math"
	"testing"
)

// The table is generated, so what is worth checking here is that it survives
// the trip into the binary and says something sane about Helsinki.
func TestJunctionCentersTable(t *testing.T) {
	if len(junctionCenters) < 400 {
		t.Fatalf("expected the embedded table to hold most of the ~565 signals, got %d", len(junctionCenters))
	}

	for key, center := range junctionCenters {
		lon, lat := center[0], center[1]
		// Helsinki, generously: Espoo's border to Vuosaari, the southern
		// islands to Vantaa. A coordinate pair swapped in generation lands
		// far outside this.
		if lon < 24.6 || lon > 25.3 || lat < 59.9 || lat > 60.35 {
			t.Errorf("%s: centre [%v, %v] is not in Helsinki", key, lon, lat)
		}
	}
}

func TestCenterOnJunction(t *testing.T) {
	const key = "traffic_light:28"
	center, ok := junctionCenters[key]
	if !ok {
		t.Fatalf("expected the table to carry %s", key)
	}

	original := [2]float64{24.88343628, 60.19953605}
	got, centered := centerOnJunction("traffic_light", 28, original)
	if !centered {
		t.Fatal("expected a signal in the table to be recentred")
	}
	if got != center {
		t.Errorf("expected the table's centre %v, got %v", center, got)
	}

	// The correction refines the surveyed point; it never picks a different
	// junction. The generator caps the shift at 45 m and this is the check
	// that the cap made it into the shipped data.
	const metersPerDegreeLat = 111320.0
	shift := math.Hypot(
		(got[1]-original[1])*metersPerDegreeLat,
		(got[0]-original[0])*metersPerDegreeLat*math.Cos(original[1]*math.Pi/180),
	)
	if shift > 45 {
		t.Errorf("centre moved the signal %.1f m, further than the generator's cap", shift)
	}

	// A warning light numbered 28 is a different junction from traffic light
	// 28: the two layers number independently, so the table must key on both.
	if warning, ok := junctionCenters["warning_light:28"]; ok && warning == center {
		t.Error("warning-light and traffic-light numbers must not share a table entry")
	}

	unknown := [2]float64{24.9, 60.2}
	got, centered = centerOnJunction("traffic_light", 999999, unknown)
	if centered || got != unknown {
		t.Errorf("a signal outside the table must keep its open-data point, got %v (centered=%v)", got, centered)
	}
}
