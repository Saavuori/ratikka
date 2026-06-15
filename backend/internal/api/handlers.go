package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ratikka/internal/cache"
)

var (
	Version   = "dev"
	BuildDate = "unknown"
	GitCommit = "unknown"
)

var startTime = time.Now()

type Handlers struct {
	cache cache.Cache
	gql   *GraphQLClient
	mqtt  interface {
		IsConnected() bool
	}
}

func NewHandlers(c cache.Cache, gql *GraphQLClient, mqtt interface{ IsConnected() bool }) *Handlers {
	return &Handlers{
		cache: c,
		gql:   gql,
		mqtt:  mqtt,
	}
}

// Health Response
type HealthResponse struct {
	Status         string `json:"status"`
	MQTTConnected  bool   `json:"mqtt_connected"`
	RedisConnected bool   `json:"redis_connected"`
	ActiveVehicles int    `json:"active_vehicles"`
	UptimeSeconds  int64  `json:"uptime_seconds"`
}

func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	redisConnected := h.cache.Ping(r.Context()) == nil
	mqttConnected := h.mqtt.IsConnected()

	activeVehicles := 0
	if positions, err := h.cache.GetAllPositions(r.Context()); err == nil {
		activeVehicles = len(positions)
	}

	res := HealthResponse{
		Status:         "healthy",
		MQTTConnected:  mqttConnected,
		RedisConnected: redisConnected,
		ActiveVehicles: activeVehicles,
		UptimeSeconds:  int64(time.Since(startTime).Seconds()),
	}

	if !redisConnected || !mqttConnected {
		res.Status = "degraded"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

// Version Response
type VersionResponse struct {
	Version   string `json:"version"`
	BuildDate string `json:"build_date"`
	GitCommit string `json:"git_sha"`
}

func (h *Handlers) Version(w http.ResponseWriter, r *http.Request) {
	res := VersionResponse{
		Version:   Version,
		BuildDate: BuildDate,
		GitCommit: GitCommit,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

// Trip Details Output Structs
type TripDetailsResponse struct {
	TripId   string              `json:"tripId"`
	Route    RouteResponse       `json:"route"`
	Headsign string              `json:"headsign"`
	Stops    []StopArrival       `json:"stops"`
	Geometry string              `json:"geometry,omitempty"`
}

type RouteResponse struct {
	ShortName string `json:"shortName"`
	LongName  string `json:"longName"`
	Color     string `json:"color"`
}

type StopArrival struct {
	GtfsId           string  `json:"gtfsId"`
	Name             string  `json:"name"`
	Code             string  `json:"code"`
	Lat              float64 `json:"lat"`
	Lon              float64 `json:"lon"`
	ScheduledArrival string  `json:"scheduledArrival"`
	RealtimeArrival  string  `json:"realtimeArrival"`
	Delay            int     `json:"delay"`
	Realtime         bool    `json:"realtime"`
}

func convertTripID(id string) string {
	replacer := strings.NewReplacer(
		"_Mo_", "_Ma_",
		"_Tu_", "_Ti_",
		"_We_", "_Ke_",
		"_Th_", "_To_",
		"_Fr_", "_Pe_",
		"_Sa_", "_La_",
	)
	return replacer.Replace(id)
}

func (h *Handlers) TripDetails(w http.ResponseWriter, r *http.Request) {
	tripId := r.PathValue("tripId")
	if tripId == "" {
		http.Error(w, "missing tripId", http.StatusBadRequest)
		return
	}
	tripId = convertTripID(tripId)

	queryStr := `
		query GetTripDetails($tripId: String!) {
			trip(id: $tripId) {
				gtfsId
				route {
					shortName
					longName
					mode
					color
				}
				tripHeadsign
				stoptimes {
					scheduledArrival
					realtimeArrival
					arrivalDelay
					realtime
					realtimeState
					stop {
						gtfsId
						name
						code
						lat
						lon
					}
				}
				tripGeometry {
					length
					points
				}
			}
		}
	`

	variables := map[string]interface{}{"tripId": tripId}
	var raw rawTripResponse

	if err := h.gql.query(r.Context(), queryStr, variables, &raw); err != nil {
		log.Printf("GraphQL query error for trip %s: %v\n", tripId, err)
		http.Error(w, "upstream api error", http.StatusBadGateway)
		return
	}

	if raw.Trip == nil {
		http.Error(w, "trip not found", http.StatusNotFound)
		return
	}

	// Format response
	t := raw.Trip
	resp := TripDetailsResponse{
		TripId: t.GtfsId,
		Route: RouteResponse{
			ShortName: t.Route.ShortName,
			LongName:  t.Route.LongName,
			Color:     t.Route.Color,
		},
		Headsign: t.TripHeadsign,
		Stops:    make([]StopArrival, 0, len(t.Stoptimes)),
	}

	if t.TripGeometry != nil {
		resp.Geometry = t.TripGeometry.Points
	}

	for _, stoptime := range t.Stoptimes {
		resp.Stops = append(resp.Stops, StopArrival{
			GtfsId:           stoptime.Stop.GtfsId,
			Name:             stoptime.Stop.Name,
			Code:             stoptime.Stop.Code,
			Lat:              stoptime.Stop.Lat,
			Lon:              stoptime.Stop.Lon,
			ScheduledArrival: formatSeconds(stoptime.ScheduledArrival),
			RealtimeArrival:  formatSeconds(stoptime.RealtimeArrival),
			Delay:            stoptime.ArrivalDelay,
			Realtime:         stoptime.Realtime,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// Stop Details Output Structs
type StopDetailsResponse struct {
	Stop       StopInfo            `json:"stop"`
	Routes     []string            `json:"routes"`
	Departures []StopDepartureInfo `json:"departures"`
}

type StopInfo struct {
	GtfsId string  `json:"gtfsId"`
	Name   string  `json:"name"`
	Code   string  `json:"code"`
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
}

type StopDepartureInfo struct {
	Line             string `json:"line"`
	Headsign         string `json:"headsign"`
	ScheduledArrival string `json:"scheduledArrival"`
	RealtimeArrival  string `json:"realtimeArrival"`
	Delay            int    `json:"delay"`
	Realtime         bool   `json:"realtime"`
	TripId           string `json:"tripId"`
}

func (h *Handlers) StopDetails(w http.ResponseWriter, r *http.Request) {
	stopId := r.PathValue("stopId")
	if stopId == "" {
		http.Error(w, "missing stopId", http.StatusBadRequest)
		return
	}

	departuresVal := r.URL.Query().Get("departures")
	numDepartures := 10
	if val, err := strconv.Atoi(departuresVal); err == nil && val > 0 {
		numDepartures = val
	}

	queryStr := `
		query GetStopTimetable($stopId: String!, $numberOfDepartures: Int!) {
			stop(id: $stopId) {
				gtfsId
				name
				code
				lat
				lon
				routes {
					shortName
					longName
					mode
				}
				stoptimesWithoutPatterns(numberOfDepartures: $numberOfDepartures) {
					scheduledArrival
					realtimeArrival
					arrivalDelay
					realtime
					realtimeState
					headsign
					trip {
						gtfsId
						route {
							shortName
							color
						}
					}
				}
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
		http.Error(w, "upstream api error", http.StatusBadGateway)
		return
	}

	if raw.Stop == nil {
		http.Error(w, "stop not found", http.StatusNotFound)
		return
	}

	s := raw.Stop
	resp := StopDetailsResponse{
		Stop: StopInfo{
			GtfsId: s.GtfsId,
			Name:   s.Name,
			Code:   s.Code,
			Lat:    s.Lat,
			Lon:    s.Lon,
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
		resp.Departures = append(resp.Departures, StopDepartureInfo{
			Line:             dep.Trip.Route.ShortName,
			Headsign:         dep.Headsign,
			ScheduledArrival: formatSeconds(dep.ScheduledArrival),
			RealtimeArrival:  formatSeconds(dep.RealtimeArrival),
			Delay:            dep.ArrivalDelay,
			Realtime:         dep.Realtime,
			TripId:           dep.Trip.GtfsId,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func formatSeconds(sec int) string {
	h := (sec / 3600) % 24
	m := (sec / 60) % 60
	return fmt.Sprintf("%02d:%02d", h, m)
}

type RouteDetailsResponse struct {
	ShortName  string   `json:"shortName"`
	Color      string   `json:"color"`
	Geometries []string `json:"geometries"`
}

type rawRouteResponse struct {
	Routes []struct {
		GtfsId    string `json:"gtfsId"`
		ShortName string `json:"shortName"`
		Mode      string `json:"mode"`
		Color     string `json:"color"`
		Patterns  []struct {
			PatternGeometry struct {
				Points string `json:"points"`
			} `json:"patternGeometry"`
		} `json:"patterns"`
	} `json:"routes"`
}

func (h *Handlers) RouteDetails(w http.ResponseWriter, r *http.Request) {
	shortName := r.PathValue("shortName")
	if shortName == "" {
		http.Error(w, "missing shortName", http.StatusBadRequest)
		return
	}

	queryStr := `
		query GetRouteDetails($shortName: String!) {
			routes(name: $shortName, transportModes: [TRAM]) {
				gtfsId
				shortName
				mode
				color
				patterns {
					patternGeometry {
						points
					}
				}
			}
		}
	`

	variables := map[string]interface{}{"shortName": shortName}
	var raw rawRouteResponse

	if err := h.gql.query(r.Context(), queryStr, variables, &raw); err != nil {
		log.Printf("GraphQL query error for route %s: %v\n", shortName, err)
		http.Error(w, "upstream api error", http.StatusBadGateway)
		return
	}

	if len(raw.Routes) == 0 {
		http.Error(w, "route not found", http.StatusNotFound)
		return
	}

	// Find exact match or fallback to first
	var matchedRoute *struct {
		GtfsId    string `json:"gtfsId"`
		ShortName string `json:"shortName"`
		Mode      string `json:"mode"`
		Color     string `json:"color"`
		Patterns  []struct {
			PatternGeometry struct {
				Points string `json:"points"`
			} `json:"patternGeometry"`
		} `json:"patterns"`
	}

	for _, route := range raw.Routes {
		if route.ShortName == shortName {
			matchedRoute = &route
			break
		}
	}

	if matchedRoute == nil {
		matchedRoute = &raw.Routes[0]
	}

	// Extract unique geometries
	geometries := make([]string, 0, len(matchedRoute.Patterns))
	seen := make(map[string]bool)
	for _, pattern := range matchedRoute.Patterns {
		pts := pattern.PatternGeometry.Points
		if pts != "" && !seen[pts] {
			seen[pts] = true
			geometries = append(geometries, pts)
		}
	}

	resp := RouteDetailsResponse{
		ShortName:  matchedRoute.ShortName,
		Color:      matchedRoute.Color,
		Geometries: geometries,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
