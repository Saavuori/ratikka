package api

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"time"
)

// Stop details: what is departing from one stop, and when.

type StopDetailsResponse struct {
	FetchedAt  int64               `json:"fetchedAt"`
	Stop       StopInfo            `json:"stop"`
	Routes     []string            `json:"routes"`
	Departures []StopDepartureInfo `json:"departures"`
}

type StopInfo struct {
	PlatformCode string  `json:"platformCode,omitempty"`
	GtfsId       string  `json:"gtfsId"`
	Name         string  `json:"name"`
	Code         string  `json:"code"`
	Lat          float64 `json:"lat"`
	Lon          float64 `json:"lon"`
}

type StopDepartureInfo struct {
	ScheduledDeparture     string `json:"scheduledDeparture,omitempty"`
	RealtimeDeparture      string `json:"realtimeDeparture,omitempty"`
	ScheduledDepartureTime int64  `json:"scheduledDepartureTime,omitempty"`
	RealtimeDepartureTime  int64  `json:"realtimeDepartureTime,omitempty"`
	DepartureDelay         int    `json:"departureDelay"`
	RealtimeState          string `json:"realtimeState,omitempty"`
	Line                   string `json:"line"`
	Headsign               string `json:"headsign"`
	ScheduledArrival       string `json:"scheduledArrival"`
	RealtimeArrival        string `json:"realtimeArrival"`
	Delay                  int    `json:"delay"`
	Realtime               bool   `json:"realtime"`
	TripId                 string `json:"tripId"`
	// Trip identity, carried so the frontend can match a departure to the
	// live vehicle actually serving it without guessing from the line number.
	RouteId          string `json:"routeId,omitempty"`
	ServiceDate      string `json:"serviceDate,omitempty"`
	DirectionId      *int   `json:"directionId,omitempty"`
	StartTimeSeconds *int   `json:"startTimeSeconds,omitempty"` // trip origin, seconds since service midnight
	Mode             string `json:"mode,omitempty"`
}

func (h *Handlers) StopDetails(w http.ResponseWriter, r *http.Request) {
	stopId := r.PathValue("stopId")
	if stopId == "" {
		http.Error(w, "missing stopId", http.StatusBadRequest)
		return
	}

	departuresVal := r.URL.Query().Get("departures")
	numDepartures := 10
	// Cap the value: each distinct count is a distinct cache key, and huge
	// values would be forwarded verbatim to the upstream API.
	if val, err := strconv.Atoi(departuresVal); err == nil && val > 0 && val <= 50 {
		numDepartures = val
	}

	key := fmt.Sprintf("stop:%s:%d", stopId, numDepartures)

	serveCached(h, w, key, 10*time.Second, func() (StopDetailsResponse, error) {

		queryStr := `
			query GetStopTimetable($stopId: String!, $numberOfDepartures: Int!) {
				stop(id: $stopId) {
					gtfsId
					name
					code
					platformCode
					lat
					lon
					routes {
						shortName
						longName
						mode
					}
					stoptimesWithoutPatterns(numberOfDepartures: $numberOfDepartures, omitCanceled: false) {` +
			stoptimeFields + `}
				}
			}
		`

		variables := map[string]interface{}{
			"stopId":             stopId,
			"numberOfDepartures": numDepartures,
		}
		var raw rawStopResponse

		if err := h.gql.query(r.Context(), queryStr, variables, &raw); err != nil {
			log.Printf("GraphQL query error for stop %s: %v\n", stopId, err)
			return StopDetailsResponse{}, errUpstream
		}

		if raw.Stop == nil {
			return StopDetailsResponse{}, notFound("stop not found")
		}

		s := raw.Stop
		resp := StopDetailsResponse{
			FetchedAt: time.Now().UnixMilli(),
			Stop: StopInfo{
				PlatformCode: s.PlatformCode,
				GtfsId:       s.GtfsId,
				Name:         s.Name,
				Code:         s.Code,
				Lat:          s.Lat,
				Lon:          s.Lon,
			},
			Routes:     make([]string, 0),
			Departures: make([]StopDepartureInfo, 0, len(s.StoptimesWithoutPatterns)),
		}

		// Extract unique routes
		seenRoutes := make(map[string]bool)
		for _, route := range s.Routes {
			if !seenRoutes[route.ShortName] {
				seenRoutes[route.ShortName] = true
				resp.Routes = append(resp.Routes, route.ShortName)
			}
		}

		for _, dep := range s.StoptimesWithoutPatterns {
			resp.Departures = append(resp.Departures, toStopDeparture(dep))
		}

		return resp, nil
	})
}

// toStopDeparture maps one upstream stoptime onto the departure the API
// serves, trip identity included.
func toStopDeparture(dep rawStoptime) StopDepartureInfo {
	departure := StopDepartureInfo{
		ScheduledDeparture:     optionalTime(dep.ScheduledDeparture),
		RealtimeDeparture:      optionalTime(dep.RealtimeDeparture),
		ScheduledDepartureTime: serviceTimestamp(dep.ServiceDay, dep.ScheduledDeparture),
		RealtimeDepartureTime:  serviceTimestamp(dep.ServiceDay, dep.RealtimeDeparture),
		DepartureDelay:         dep.DepartureDelay,
		RealtimeState:          dep.RealtimeState,
		Line:                   dep.Trip.Route.ShortName,
		Headsign:               dep.Headsign,
		ScheduledArrival:       formatSeconds(dep.ScheduledArrival),
		RealtimeArrival:        formatSeconds(dep.RealtimeArrival),
		Delay:                  dep.ArrivalDelay,
		Realtime:               dep.Realtime,
		TripId:                 dep.Trip.GtfsId,
		RouteId:                dep.Trip.Route.GtfsId,
		ServiceDate:            stopServiceDate(dep.ServiceDay),
		DirectionId:            directionID(dep.Trip.DirectionId),
		Mode:                   dep.Trip.Route.Mode,
	}
	if origin := dep.Trip.DepartureStoptime; origin != nil &&
		origin.ScheduledDeparture != nil && *origin.ScheduledDeparture >= 0 {
		departure.StartTimeSeconds = origin.ScheduledDeparture
	}
	return departure
}

// stopServiceDate renders a stoptime's serviceDay as a YYYY-MM-DD service
// date. serviceDay is midnight of the operating day in Europe/Helsinki, so it
// is read at local noon — that lands inside the same calendar day under either
// UTC offset, and needs no tzdata on the server.
func stopServiceDate(day *int64) string {
	if day == nil || *day <= 0 || *day > math.MaxInt64-12*3600 {
		return ""
	}
	return time.Unix(*day+12*3600, 0).UTC().Format("2006-01-02")
}

func formatSeconds(sec int) string {
	h := (sec / 3600) % 24
	m := (sec / 60) % 60
	return fmt.Sprintf("%02d:%02d", h, m)
}

// RoutePattern is one directional variant of a line: the polyline it runs
// along, and which of the route's two directions it belongs to. The frontend
// snaps vehicles onto these, and a tram's two directions run on their own two
// sets of rails — so which direction a polyline belongs to is what decides
// which of them a vehicle is placed on.
