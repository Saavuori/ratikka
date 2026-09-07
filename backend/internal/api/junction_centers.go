package api

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
)

// The open-data signal point is a surveyed installation — a controller
// cabinet, a mast on a corner — and not the middle of the junction it governs.
// It is routinely 5-30 m off centre, which is invisible on a citywide view and
// very visible at the zooms the marker is actually drawn at: the signal ends up
// inside a building, on a pavement, or a carriageway away from the tram that is
// sitting at it.
//
// The middle is recoverable from Helsinki's own street geometry — the
// centrelines meet at the junction, and the marked crossings ring it — but
// that is 111,000 line features to intersect, which is not work to redo every
// day for a dataset that changes when a street is rebuilt. So it is computed
// offline by scripts/generate-junction-centers.mjs and shipped as a table
// applied here, once per fetch, to the points the WFS returns.
//
//go:embed junction_centers.json
var junctionCentersJSON []byte

type junctionCenterTable struct {
	Generated         string                `json:"generated"`
	Signals           int                   `json:"signals"`
	Corrected         int                   `json:"corrected"`
	MedianShiftMeters float64               `json:"medianShiftMeters"`
	Centers           map[string][2]float64 `json:"centers"`
}

var junctionCenters = loadJunctionCenters()

func loadJunctionCenters() map[string][2]float64 {
	var table junctionCenterTable
	if err := json.Unmarshal(junctionCentersJSON, &table); err != nil {
		// A missing or broken table costs accuracy, not the endpoint: every
		// signal simply keeps the coordinates the open data gave it.
		log.Printf("junction centers: failed to parse embedded table: %v", err)
		return nil
	}
	return table.Centers
}

// junctionCenterKey addresses the table. The two signal layers number
// independently, so warning light 27 and traffic light 27 are different
// junctions and cannot share a key.
func junctionCenterKey(kind string, id int) string {
	return fmt.Sprintf("%s:%d", kind, id)
}

// centerOnJunction moves a signal to the middle of its junction where the
// table knows it, and reports whether it did.
func centerOnJunction(kind string, id int, coords [2]float64) ([2]float64, bool) {
	center, ok := junctionCenters[junctionCenterKey(kind, id)]
	if !ok {
		return coords, false
	}
	return center, true
}
