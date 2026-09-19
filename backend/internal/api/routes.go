package api

import (
	"log"
	"net/http"
	"time"
)

// Route details: a line's patterns, its geometry and the stops it serves.

type RoutePattern struct {
	Points string `json:"points"`
	// GTFS direction_id (0 or 1). HFP reports the same thing as `dir` "1"/"2".
	DirectionID int `json:"directionId"`
}

type RouteDetailsResponse struct {
	ShortName string `json:"shortName"`
	Color     string `json:"color"`
	// Every pattern polyline, deduplicated, in the order Digitransit returned
	// them. Kept for the route ribbons the map draws, which do not care which
	// direction a polyline belongs to.
	Geometries []string `json:"geometries"`
	// The same polylines carrying their direction. Drawn from the same patterns
	// as `geometries`, so the two stay in step.
	Patterns []RoutePattern `json:"patterns"`
	Stops    []string       `json:"stops"`
}

type rawRouteResponse struct {
	Routes []struct {
		GtfsId    string `json:"gtfsId"`
		ShortName string `json:"shortName"`
		Mode      string `json:"mode"`
		Color     string `json:"color"`
		Patterns  []struct {
			DirectionId     int `json:"directionId"`
			PatternGeometry struct {
				Points string `json:"points"`
			} `json:"patternGeometry"`
			Stops []struct {
				GtfsId string `json:"gtfsId"`
			} `json:"stops"`
		} `json:"patterns"`
	} `json:"routes"`
}

// RouteDetails serves the pattern geometry and stops of a line by its short
// name. Trams, metro (M1/M2) and commuter trains (the letter lines) are all
// looked up here — their short names never collide, so one lookup covers the
// three modes the map draws route ribbons for. Buses are deliberately left out:
// there are hundreds of them and the map draws them from the JORE tiles instead.
func (h *Handlers) RouteDetails(w http.ResponseWriter, r *http.Request) {
	shortName := r.PathValue("shortName")
	if shortName == "" {
		http.Error(w, "missing shortName", http.StatusBadRequest)
		return
	}

	key := "route:" + shortName

	serveCached(h, w, key, 1*time.Hour, func() (RouteDetailsResponse, error) {

		queryStr := `
			query GetRouteDetails($shortName: String!) {
				routes(name: $shortName, transportModes: [TRAM, SUBWAY, RAIL]) {
					gtfsId
					shortName
					mode
					color
					patterns {
						directionId
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
			return RouteDetailsResponse{}, errUpstream
		}

		if len(raw.Routes) == 0 {
			return RouteDetailsResponse{}, notFound("route not found")
		}

		// Find exact match or fallback to first
		var matchedRoute *struct {
			GtfsId    string `json:"gtfsId"`
			ShortName string `json:"shortName"`
			Mode      string `json:"mode"`
			Color     string `json:"color"`
			Patterns  []struct {
				DirectionId     int `json:"directionId"`
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
		patterns := make([]RoutePattern, 0, len(matchedRoute.Patterns))
		seenGeom := make(map[string]bool)
		stops := make([]string, 0)
		seenStops := make(map[string]bool)
		for _, pattern := range matchedRoute.Patterns {
			pts := pattern.PatternGeometry.Points
			if pts != "" && !seenGeom[pts] {
				seenGeom[pts] = true
				geometries = append(geometries, pts)
				patterns = append(patterns, RoutePattern{Points: pts, DirectionID: pattern.DirectionId})
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
			Patterns:   patterns,
			Stops:      stops,
		}

		return resp, nil
	})
}
