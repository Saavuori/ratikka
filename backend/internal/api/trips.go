package api

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Trip details: the stops a running journey calls at, with its live delays.

type TripDetailsResponse struct {
	TripId   string        `json:"tripId"`
	Route    RouteResponse `json:"route"`
	Headsign string        `json:"headsign"`
	Stops    []StopArrival `json:"stops"`
	Geometry string        `json:"geometry,omitempty"`
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

	key := "trip:" + tripId

	serveCached(h, w, key, 10*time.Second, func() (TripDetailsResponse, error) {

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
			return TripDetailsResponse{}, errUpstream
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
			return TripDetailsResponse{}, notFound("trip not found")
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

		return resp, nil
	})
}

// Stop Details Output Structs
