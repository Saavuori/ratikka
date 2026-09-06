package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// These fields are shared with leg(id:) refreshes, which preserve the selected
// trip and service date rather than replacing it with a newly planned journey.
const journeyLegFields = `
	id mode transitLeg duration distance startTime endTime headsign
	serviceDate realTime realtimeState departureDelay arrivalDelay
	trip { gtfsId directionId departureStoptime { scheduledDeparture } }
	route { gtfsId shortName longName color mode }
	legGeometry { points }
	from { name lat lon stop { gtfsId name code platformCode } }
	to { name lat lon stop { gtfsId name code platformCode } }
	intermediatePlaces { name lat lon stop { gtfsId name code platformCode } }
`

func serviceDate(raw string) string {
	for _, layout := range []string{"20060102", "2006-01-02"} {
		if d, err := time.Parse(layout, raw); err == nil && d.Format(layout) == raw {
			return d.Format("2006-01-02")
		}
	}
	return ""
}

func directionID(raw json.RawMessage) *int {
	// OTP's Trip.directionId is a nullable string; tolerate numeric versions
	// too, but never turn null/unknown values into direction zero.
	var text string
	if json.Unmarshal(raw, &text) != nil {
		text = string(raw)
	}
	n, err := strconv.Atoi(text)
	if err != nil || (n != 0 && n != 1) {
		return nil
	}
	return &n
}

func toJourneyLeg(l rawPlanLeg) JourneyLeg {
	leg := JourneyLeg{
		LegId: l.ID, Mode: l.Mode, Transit: l.Transit,
		Duration: int(l.Duration), Distance: l.Distance,
		StartTime: l.StartTime, EndTime: l.EndTime, Headsign: l.Headsign,
		Realtime: l.Realtime, RealtimeState: l.RealtimeState,
		From: toJourneyPlace(l.From), To: toJourneyPlace(l.To),
		IntermediateStops: make([]JourneyPlace, 0, len(l.IntermediatePlaces)),
		Geometry:          l.LegGeometry.Points,
	}
	if l.DepartureDelay != nil {
		leg.DepartureDelay = *l.DepartureDelay
		if l.StartTime > 0 {
			leg.ScheduledStartTime = l.StartTime - int64(*l.DepartureDelay)*1000
		}
	}
	if l.ArrivalDelay != nil {
		leg.ArrivalDelay = *l.ArrivalDelay
		if l.EndTime > 0 {
			leg.ScheduledEndTime = l.EndTime - int64(*l.ArrivalDelay)*1000
		}
	}
	if l.Transit {
		// Boarding after midnight does not change the trip's service date.
		leg.ServiceDate = serviceDate(l.ServiceDate)
		if l.Trip != nil {
			leg.TripId = l.Trip.GtfsId
			leg.DirectionId = directionID(l.Trip.DirectionId)
			if dep := l.Trip.DepartureStoptime; dep != nil &&
				dep.ScheduledDeparture != nil && *dep.ScheduledDeparture >= 0 {
				leg.StartTimeSeconds = dep.ScheduledDeparture
			}
		}
	}
	if l.Route != nil {
		leg.Route = &JourneyRoute{
			GtfsId: l.Route.GtfsId, ShortName: l.Route.ShortName,
			LongName: l.Route.LongName, Color: l.Route.Color, Mode: l.Route.Mode,
		}
	}
	for _, p := range l.IntermediatePlaces {
		if p.Stop != nil {
			leg.IntermediateStops = append(leg.IntermediateStops, toJourneyPlace(p))
		}
	}
	return leg
}

type JourneyMonitorResponse struct {
	Legs      []*JourneyLeg `json:"legs"`
	FetchedAt int64         `json:"fetchedAt"`
}

// MonitorJourney refreshes selected transit legs by their opaque upstream IDs.
// Null entries mean the original leg is no longer available, not a new route.
func (h *Handlers) MonitorJourney(w http.ResponseWriter, r *http.Request) {
	ids := r.URL.Query()["legId"]
	if len(ids) == 0 || len(ids) > 8 {
		http.Error(w, "between 1 and 8 legId parameters are required", http.StatusBadRequest)
		return
	}
	for _, id := range ids {
		if strings.TrimSpace(id) == "" || len(id) > 2048 {
			http.Error(w, "invalid legId", http.StatusBadRequest)
			return
		}
	}
	idJSON, _ := json.Marshal(ids)
	key := "journey-monitor:" + string(idJSON)
	data, err, _ := h.sfGroup.Do(key, func() (interface{}, error) {
		if cached, ok := h.apiCache.Get(key); ok {
			return cached, nil
		}
		var declarations, selections []string
		vars := make(map[string]interface{}, len(ids))
		for i, id := range ids {
			name := fmt.Sprintf("leg%d", i)
			declarations = append(declarations, "$"+name+": String!")
			selections = append(selections, name+": leg(id: $"+name+") { "+journeyLegFields+" }")
			vars[name] = id
		}
		query := "query MonitorJourney(" + strings.Join(declarations, ", ") + ") { " +
			strings.Join(selections, "\n") + " }"
		var raw map[string]*rawPlanLeg
		if err := h.gql.query(r.Context(), query, vars, &raw); err != nil {
			return nil, err
		}
		out := JourneyMonitorResponse{Legs: make([]*JourneyLeg, len(ids)), FetchedAt: time.Now().UnixMilli()}
		for i := range ids {
			if l := raw[fmt.Sprintf("leg%d", i)]; l != nil {
				leg := toJourneyLeg(*l)
				out.Legs[i] = &leg
			}
		}
		body, err := json.Marshal(out)
		if err == nil {
			h.apiCache.Set(key, body, 10*time.Second)
		}
		return body, err
	})
	if err != nil {
		http.Error(w, "upstream api error", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data.([]byte))
}
