package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
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

// Config Response
type ConfigResponse struct {
	DigitransitMapKey string `json:"digitransit_map_key"`
}

func (h *Handlers) Config(w http.ResponseWriter, r *http.Request) {
	res := ConfigResponse{
		DigitransitMapKey: os.Getenv("DIGITRANSIT_API_KEY"),
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
	// First convert English day abbreviations to Finnish
	replacer := strings.NewReplacer(
		"_Mo_", "_Ma_",
		"_Tu_", "_Ti_",
		"_We_", "_Ke_",
		"_Th_", "_To_",
		"_Fr_", "_Pe_",
		"_Sa_", "_La_",
	)
	id = replacer.Replace(id)

	// Now split by "_" to find and convert the date to the Monday of that week
	parts := strings.Split(id, "_")
	if len(parts) > 1 {
		dateStr := parts[1]
		if len(dateStr) == 8 { // YYYYMMDD format
			if t, err := time.Parse("20060102", dateStr); err == nil {
				wd := t.Weekday()
				daysToSubtract := 0
				if wd == time.Sunday {
					daysToSubtract = 6
				} else {
					daysToSubtract = int(wd) - 1
				}
				monday := t.AddDate(0, 0, -daysToSubtract)
				parts[1] = monday.Format("20060102")
				id = strings.Join(parts, "_")
			}
		}
	}

	return id
}

func parseTripIdForFuzzy(tripId string) (string, int, string, int, bool) {
	// Strip HSL: prefix
	clean := strings.TrimPrefix(tripId, "HSL:")
	parts := strings.Split(clean, "_")
	if len(parts) < 5 {
		return "", 0, "", 0, false
	}

	routePart := "HSL:" + parts[0]

	// Date: parts[1] (format YYYYMMDD) -> YYYY-MM-DD
	if len(parts[1]) != 8 {
		return "", 0, "", 0, false
	}
	datePart := fmt.Sprintf("%s-%s-%s", parts[1][0:4], parts[1][4:6], parts[1][6:8])

	// Direction: parts[3]
	dirVal, err := strconv.Atoi(parts[3])
	if err != nil {
		return "", 0, "", 0, false
	}
	// GTFS/OTP direction is 0 or 1, but HSL MQTT direction might be 1 or 2
	direction := 0
	if dirVal == 2 {
		direction = 1
	} else if dirVal == 1 {
		direction = 0
	} else {
		direction = dirVal
	}

	// Start time: parts[4] (format HHMM or HHMMSS) -> seconds since midnight
	if len(parts[4]) < 4 {
		return "", 0, "", 0, false
	}
	hours, err1 := strconv.Atoi(parts[4][0:2])
	mins, err2 := strconv.Atoi(parts[4][2:4])
	if err1 != nil || err2 != nil {
		return "", 0, "", 0, false
	}
	timePart := (hours * 3600) + (mins * 60)

	return routePart, direction, datePart, timePart, true
}

func (h *Handlers) TripDetails(w http.ResponseWriter, r *http.Request) {
	originalTripId := r.PathValue("tripId")
	if originalTripId == "" {
		http.Error(w, "missing tripId", http.StatusBadRequest)
		return
	}
	tripId := convertTripID(originalTripId)

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
		// Attempt fuzzyTrip fallback query
		if route, dir, date, timeSec, ok := parseTripIdForFuzzy(originalTripId); ok {
			log.Printf("Trip %s not found by ID. Attempting fuzzyTrip fallback with route=%s dir=%d date=%s time=%d", originalTripId, route, dir, date, timeSec)

			fuzzyQueryStr := `
				query GetFuzzyTripDetails($route: String!, $direction: Int!, $date: String!, $time: Int!) {
					fuzzyTrip(route: $route, direction: $direction, date: $date, time: $time) {
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

			fuzzyVars := map[string]interface{}{
				"route":     route,
				"direction": dir,
				"date":      date,
				"time":      timeSec,
			}

			type fuzzyTripData struct {
				GtfsId       string       `json:"gtfsId"`
				Route        rawRouteInfo `json:"route"`
				TripHeadsign string       `json:"tripHeadsign"`
				Stoptimes    []struct {
					ScheduledArrival   int    `json:"scheduledArrival"`
					RealtimeArrival    int    `json:"realtimeArrival"`
					ArrivalDelay       int    `json:"arrivalDelay"`
					ScheduledDeparture int    `json:"scheduledDeparture"`
					RealtimeDeparture  int    `json:"realtimeDeparture"`
					DepartureDelay     int    `json:"departureDelay"`
					Realtime           bool   `json:"realtime"`
					RealtimeState      string `json:"realtimeState"`
					Stop               struct {
						GtfsId string  `json:"gtfsId"`
						Name   string  `json:"name"`
						Code   string  `json:"code"`
						Lat    float64 `json:"lat"`
						Lon    float64 `json:"lon"`
					} `json:"stop"`
				} `json:"stoptimes"`
				TripGeometry *struct {
					Length int    `json:"length"`
					Points string `json:"points"`
				} `json:"tripGeometry"`
			}

			var fuzzyRaw struct {
				FuzzyTrip *fuzzyTripData `json:"fuzzyTrip"`
			}

			if err := h.gql.query(r.Context(), fuzzyQueryStr, fuzzyVars, &fuzzyRaw); err == nil && fuzzyRaw.FuzzyTrip != nil {
				// Copy stoptimes slice
				stoptimes := make([]struct {
					ScheduledArrival   int    `json:"scheduledArrival"`
					RealtimeArrival    int    `json:"realtimeArrival"`
					ArrivalDelay       int    `json:"arrivalDelay"`
					ScheduledDeparture int    `json:"scheduledDeparture"`
					RealtimeDeparture  int    `json:"realtimeDeparture"`
					DepartureDelay     int    `json:"departureDelay"`
					Realtime           bool   `json:"realtime"`
					RealtimeState      string `json:"realtimeState"`
					Stop               struct {
						GtfsId string  `json:"gtfsId"`
						Name   string  `json:"name"`
						Code   string  `json:"code"`
						Lat    float64 `json:"lat"`
						Lon    float64 `json:"lon"`
					} `json:"stop"`
				}, len(fuzzyRaw.FuzzyTrip.Stoptimes))

				for i, s := range fuzzyRaw.FuzzyTrip.Stoptimes {
					stoptimes[i] = s
				}

				raw.Trip = &struct {
					GtfsId           string       `json:"gtfsId"`
					Route            rawRouteInfo `json:"route"`
					TripHeadsign     string       `json:"tripHeadsign"`
					Stoptimes []struct {
						ScheduledArrival   int `json:"scheduledArrival"`
						RealtimeArrival    int `json:"realtimeArrival"`
						ArrivalDelay       int `json:"arrivalDelay"`
						ScheduledDeparture int `json:"scheduledDeparture"`
						RealtimeDeparture  int `json:"realtimeDeparture"`
						DepartureDelay     int `json:"departureDelay"`
						Realtime           bool `json:"realtime"`
						RealtimeState      string `json:"realtimeState"`
						Stop               struct {
							GtfsId string  `json:"gtfsId"`
							Name   string  `json:"name"`
							Code   string  `json:"code"`
							Lat    float64 `json:"lat"`
							Lon    float64 `json:"lon"`
						} `json:"stop"`
					} `json:"stoptimes"`
					TripGeometry *struct {
						Length int    `json:"length"`
						Points string `json:"points"`
					} `json:"tripGeometry"`
				}{
					GtfsId:       fuzzyRaw.FuzzyTrip.GtfsId,
					Route:        fuzzyRaw.FuzzyTrip.Route,
					TripHeadsign: fuzzyRaw.FuzzyTrip.TripHeadsign,
					Stoptimes:    stoptimes,
					TripGeometry: fuzzyRaw.FuzzyTrip.TripGeometry,
				}
				log.Printf("Successfully resolved trip by fuzzyTrip: %s -> %s", originalTripId, fuzzyRaw.FuzzyTrip.GtfsId)
			} else if err != nil {
				log.Printf("FuzzyTrip query failed for route %s date %s: %v", route, date, err)
			}
		}
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
	Stops      []string `json:"stops"`
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
			Stops []struct {
				GtfsId string `json:"gtfsId"`
			} `json:"stops"`
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
					stops {
						gtfsId
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
			Stops []struct {
				GtfsId string `json:"gtfsId"`
			} `json:"stops"`
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

	// Extract unique geometries and stops
	geometries := make([]string, 0, len(matchedRoute.Patterns))
	seenGeom := make(map[string]bool)
	stops := make([]string, 0)
	seenStops := make(map[string]bool)
	for _, pattern := range matchedRoute.Patterns {
		pts := pattern.PatternGeometry.Points
		if pts != "" && !seenGeom[pts] {
			seenGeom[pts] = true
			geometries = append(geometries, pts)
		}
		for _, stop := range pattern.Stops {
			id := stop.GtfsId
			if id != "" && !seenStops[id] {
				seenStops[id] = true
				stops = append(stops, id)
			}
		}
	}

	resp := RouteDetailsResponse{
		ShortName:  matchedRoute.ShortName,
		Color:      matchedRoute.Color,
		Geometries: geometries,
		Stops:      stops,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

type BikeStationDetailsResponse struct {
	StationId       string `json:"stationId"`
	Name            string `json:"name"`
	AllowPickup     bool   `json:"allowPickup"`
	AllowDropoff    bool   `json:"allowDropoff"`
	BikesAvailable  int    `json:"bikesAvailable"`
	SpacesAvailable int    `json:"spacesAvailable"`
}

type rawBikeStationResponse struct {
	VehicleRentalStation *struct {
		StationId         string `json:"stationId"`
		Name              string `json:"name"`
		AllowPickup       bool   `json:"allowPickup"`
		AllowDropoff      bool   `json:"allowDropoff"`
		AvailableVehicles *struct {
			ByType []struct {
				Count       int `json:"count"`
				VehicleType struct {
					FormFactor string `json:"formFactor"`
				} `json:"vehicleType"`
			} `json:"byType"`
		} `json:"availableVehicles"`
		AvailableSpaces *struct {
			ByType []struct {
				Count       int `json:"count"`
				VehicleType struct {
					FormFactor string `json:"formFactor"`
				} `json:"vehicleType"`
			} `json:"byType"`
		} `json:"availableSpaces"`
	} `json:"vehicleRentalStation"`
}

func (h *Handlers) BikeStationDetails(w http.ResponseWriter, r *http.Request) {
	stationId := r.PathValue("stationId")
	if stationId == "" {
		http.Error(w, "missing stationId", http.StatusBadRequest)
		return
	}

	queryStr := `
		query GetBikeStationDetails($stationId: String!) {
			vehicleRentalStation(id: $stationId) {
				stationId
				name
				allowPickup
				allowDropoff
				availableVehicles {
					byType {
						count
						vehicleType {
							formFactor
						}
					}
				}
				availableSpaces {
					byType {
						count
						vehicleType {
							formFactor
						}
					}
				}
			}
		}
	`

	variables := map[string]interface{}{"stationId": stationId}
	var raw rawBikeStationResponse

	if err := h.gql.query(r.Context(), queryStr, variables, &raw); err != nil {
		log.Printf("GraphQL query error for bike station %s: %v\n", stationId, err)
		http.Error(w, "upstream api error", http.StatusBadGateway)
		return
	}

	if raw.VehicleRentalStation == nil {
		http.Error(w, "bike station not found", http.StatusNotFound)
		return
	}

	s := raw.VehicleRentalStation
	bikes := 0
	if s.AvailableVehicles != nil {
		for _, bt := range s.AvailableVehicles.ByType {
			if strings.ToUpper(bt.VehicleType.FormFactor) == "BICYCLE" {
				bikes += bt.Count
			}
		}
	}

	spaces := 0
	if s.AvailableSpaces != nil {
		for _, bt := range s.AvailableSpaces.ByType {
			if strings.ToUpper(bt.VehicleType.FormFactor) == "BICYCLE" {
				spaces += bt.Count
			}
		}
	}

	resp := BikeStationDetailsResponse{
		StationId:       s.StationId,
		Name:            s.Name,
		AllowPickup:     s.AllowPickup,
		AllowDropoff:    s.AllowDropoff,
		BikesAvailable:  bikes,
		SpacesAvailable: spaces,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

