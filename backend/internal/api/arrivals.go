package api

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

// MaxArrivalStops caps one batched request. The map asks for the handful of
// stops nearest the middle of the screen, not everything in view, so this is a
// ceiling rather than a target — and it bounds what a single client can make
// the upstream API do in one round trip.
const MaxArrivalStops = 12

// arrivalsPerStop is how many departures each stop contributes. The map draws
// one label per stop; the spares exist so a cancelled or already-departed row
// does not leave the label empty.
const arrivalsPerStop = 3

// StopArrivals is the next few departures from one stop.
type StopArrivals struct {
	GtfsId     string              `json:"gtfsId"`
	Name       string              `json:"name"`
	Departures []StopDepartureInfo `json:"departures"`
}

// StopsArrivalsResponse is the payload for GET /api/v1/stops/arrivals.
type StopsArrivalsResponse struct {
	Stops     map[string]StopArrivals `json:"stops"`
	FetchedAt int64                   `json:"fetchedAt"`
}

// arrivalsQuery builds a single GraphQL document that asks for every requested
// stop at once, one aliased selection each.
//
// The stop IDs travel as variables, never interpolated into the document: an ID
// arrives from the query string, and a request that pastes caller input into a
// query is a request that lets the caller write the query.
func arrivalsQuery(count int) string {
	var params, selections strings.Builder
	for i := 0; i < count; i++ {
		if i > 0 {
			params.WriteString(", ")
		}
		fmt.Fprintf(&params, "$id%d: String!", i)
		fmt.Fprintf(&selections, "\n\t\t\ts%d: stop(id: $id%d) {\n\t\t\t\tgtfsId\n\t\t\t\tname\n\t\t\t\tstoptimesWithoutPatterns(numberOfDepartures: %d, omitCanceled: false) {%s}\n\t\t\t}",
			i, i, arrivalsPerStop, stoptimeFields)
	}
	return fmt.Sprintf("query StopArrivals(%s) {%s\n\t\t}", params.String(), selections.String())
}

// normalizeStopIDs de-duplicates the requested IDs and puts them in a stable
// order, so the same set of stops is one cache entry however it was asked for.
func normalizeStopIDs(raw []string) []string {
	seen := make(map[string]bool, len(raw))
	ids := make([]string, 0, len(raw))
	for _, id := range raw {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		if !strings.HasPrefix(id, "HSL:") {
			id = "HSL:" + id
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	sort.Strings(ids)
	if len(ids) > MaxArrivalStops {
		ids = ids[:MaxArrivalStops]
	}
	return ids
}

// StopsArrivals serves the next departures for several stops in one round
// trip. The map labels every stop in view once it is zoomed in far enough, and
// a request per stop would be a request per stop every refresh.
func (h *Handlers) StopsArrivals(w http.ResponseWriter, r *http.Request) {
	ids := normalizeStopIDs(r.URL.Query()["id"])
	if len(ids) == 0 {
		http.Error(w, "at least one id is required", http.StatusBadRequest)
		return
	}

	key := "arrivals:" + strings.Join(ids, ",")
	serveCached(h, w, key, 10*time.Second, func() (StopsArrivalsResponse, error) {
		variables := make(map[string]any, len(ids))
		for i, id := range ids {
			variables[fmt.Sprintf("id%d", i)] = id
		}
		// Every alias selects a stop, so the whole data object decodes as one
		// map. A stop the upstream API does not know decodes as a nil entry.
		var raw map[string]*rawStop
		if err := h.gql.query(r.Context(), arrivalsQuery(len(ids)), variables, &raw); err != nil {
			return StopsArrivalsResponse{}, errUpstream
		}

		resp := StopsArrivalsResponse{
			Stops:     make(map[string]StopArrivals, len(ids)),
			FetchedAt: time.Now().UnixMilli(),
		}
		for _, stop := range raw {
			if stop == nil || stop.GtfsId == "" {
				continue
			}
			arrivals := StopArrivals{
				GtfsId:     stop.GtfsId,
				Name:       stop.Name,
				Departures: make([]StopDepartureInfo, 0, len(stop.StoptimesWithoutPatterns)),
			}
			for _, dep := range stop.StoptimesWithoutPatterns {
				arrivals.Departures = append(arrivals.Departures, toStopDeparture(dep))
			}
			resp.Stops[stop.GtfsId] = arrivals
		}
		return resp, nil
	})
}
