package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// GeocodeURLEndpoint is the Digitransit Pelias geocoding search endpoint. It is
// a package variable so tests can point it at a mock server.
var GeocodeURLEndpoint = "https://api.digitransit.fi/geocoding/v1/search"

// --- Geocode (destination autocomplete) -----------------------------------

// GeocodeResult is a single place suggestion returned to the frontend.
type GeocodeResult struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Label    string  `json:"label"`
	Locality string  `json:"locality,omitempty"`
	Layer    string  `json:"layer,omitempty"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
}

// GeocodeResponse is the payload for GET /api/v1/geocode.
type GeocodeResponse struct {
	Results []GeocodeResult `json:"results"`
}

// rawGeocodeResponse mirrors the subset of the Pelias GeoJSON response we use.
type rawGeocodeResponse struct {
	Features []struct {
		Geometry struct {
			Coordinates []float64 `json:"coordinates"` // [lon, lat]
		} `json:"geometry"`
		Properties struct {
			ID       string `json:"id"`
			GID      string `json:"gid"`
			Name     string `json:"name"`
			Label    string `json:"label"`
			Locality string `json:"locality"`
			Layer    string `json:"layer"`
		} `json:"properties"`
	} `json:"features"`
}

// Geocode proxies the Digitransit geocoding search so the subscription key never
// reaches the browser. It powers the destination search autocomplete.
func (h *Handlers) Geocode(w http.ResponseWriter, r *http.Request) {
	text := strings.TrimSpace(r.URL.Query().Get("text"))
	if text == "" {
		http.Error(w, "missing text", http.StatusBadRequest)
		return
	}

	// Optional focus point (typically the user's current location) so nearby
	// results are ranked first.
	focusLat := r.URL.Query().Get("lat")
	focusLon := r.URL.Query().Get("lon")

	key := fmt.Sprintf("geocode:%s:%s:%s", strings.ToLower(text), focusLat, focusLon)

	if cached, ok := h.apiCache.Get(key); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Write(cached)
		return
	}

	dataInterface, err, _ := h.sfGroup.Do(key, func() (interface{}, error) {
		if cached, ok := h.apiCache.Get(key); ok {
			return cached, nil
		}

		params := url.Values{}
		params.Set("text", text)
		params.Set("size", "6")
		// Restrict to the HSL region so suggestions are relevant.
		params.Set("boundary.rect.min_lat", "59.9")
		params.Set("boundary.rect.max_lat", "60.5")
		params.Set("boundary.rect.min_lon", "24.3")
		params.Set("boundary.rect.max_lon", "25.5")
		if lat, err := strconv.ParseFloat(focusLat, 64); err == nil {
			if lon, err := strconv.ParseFloat(focusLon, 64); err == nil {
				params.Set("focus.point.lat", strconv.FormatFloat(lat, 'f', -1, 64))
				params.Set("focus.point.lon", strconv.FormatFloat(lon, 'f', -1, 64))
			}
		}

		reqURL := GeocodeURLEndpoint + "?" + params.Encode()
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, reqURL, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to build geocode request: %w", err)
		}
		if apiKey := h.gql.APIKey(); apiKey != "" {
			req.Header.Set("digitransit-subscription-key", apiKey)
		}

		resp, err := h.gql.HTTPClient().Do(req)
		if err != nil {
			log.Printf("geocode request failed for %q: %v", text, err)
			return nil, fmt.Errorf("upstream api error")
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
			log.Printf("geocode upstream status %d for %q: %s", resp.StatusCode, text, string(body))
			return nil, fmt.Errorf("upstream api error")
		}

		var raw rawGeocodeResponse
		if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
			return nil, fmt.Errorf("failed to decode geocode response: %w", err)
		}

		out := GeocodeResponse{Results: make([]GeocodeResult, 0, len(raw.Features))}
		for _, f := range raw.Features {
			if len(f.Geometry.Coordinates) < 2 {
				continue
			}
			id := f.Properties.GID
			if id == "" {
				id = f.Properties.ID
			}
			out.Results = append(out.Results, GeocodeResult{
				ID:       id,
				Name:     f.Properties.Name,
				Label:    f.Properties.Label,
				Locality: f.Properties.Locality,
				Layer:    f.Properties.Layer,
				Lon:      f.Geometry.Coordinates[0],
				Lat:      f.Geometry.Coordinates[1],
			})
		}

		jsonBytes, err := json.Marshal(out)
		if err != nil {
			return nil, err
		}

		h.apiCache.Set(key, jsonBytes, 60*time.Second)
		return jsonBytes, nil
	})

	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(dataInterface.([]byte))
}

// --- Journey Plan ----------------------------------------------------------

// JourneyPlace describes an endpoint of a journey leg. For transit legs the
// stop fields are populated; for walk legs they are empty.
type JourneyPlace struct {
	PlatformCode string  `json:"platformCode,omitempty"`
	Name         string  `json:"name"`
	Lat          float64 `json:"lat"`
	Lon          float64 `json:"lon"`
	StopId       string  `json:"stopId,omitempty"`
	StopCode     string  `json:"stopCode,omitempty"`
}

// JourneyRoute carries the display metadata for a transit leg's route.
type JourneyRoute struct {
	GtfsId    string `json:"gtfsId"`
	ShortName string `json:"shortName"`
	LongName  string `json:"longName"`
	Color     string `json:"color"`
	Mode      string `json:"mode"`
}

// JourneyLeg is a single leg of an itinerary (a walk or a transit ride).
type JourneyLeg struct {
	LegId              string         `json:"legId,omitempty"`
	TripId             string         `json:"tripId,omitempty"`
	ServiceDate        string         `json:"serviceDate,omitempty"`
	DirectionId        *int           `json:"directionId,omitempty"`
	StartTimeSeconds   *int           `json:"startTimeSeconds,omitempty"` // trip origin, seconds since service midnight
	Realtime           bool           `json:"realtime"`
	RealtimeState      string         `json:"realtimeState,omitempty"`
	DepartureDelay     int            `json:"departureDelay"`
	ArrivalDelay       int            `json:"arrivalDelay"`
	ScheduledStartTime int64          `json:"scheduledStartTime,omitempty"`
	ScheduledEndTime   int64          `json:"scheduledEndTime,omitempty"`
	Mode               string         `json:"mode"`
	Transit            bool           `json:"transit"`
	Duration           int            `json:"duration"`  // seconds
	Distance           float64        `json:"distance"`  // meters
	StartTime          int64          `json:"startTime"` // epoch ms
	EndTime            int64          `json:"endTime"`   // epoch ms
	Headsign           string         `json:"headsign,omitempty"`
	Route              *JourneyRoute  `json:"route,omitempty"`
	From               JourneyPlace   `json:"from"`
	To                 JourneyPlace   `json:"to"`
	IntermediateStops  []JourneyPlace `json:"intermediateStops"`
	Geometry           string         `json:"geometry"` // encoded polyline
}

// JourneyItinerary is one suggested way to reach the destination.
type JourneyItinerary struct {
	Duration     int          `json:"duration"` // seconds
	WalkDistance float64      `json:"walkDistance"`
	StartTime    int64        `json:"startTime"` // epoch ms
	EndTime      int64        `json:"endTime"`   // epoch ms
	Transfers    int          `json:"transfers"`
	Legs         []JourneyLeg `json:"legs"`
}

// JourneyPlanResponse is the payload for GET /api/v1/plan.
type JourneyPlanResponse struct {
	FetchedAt   int64              `json:"fetchedAt"`
	Itineraries []JourneyItinerary `json:"itineraries"`
}

// rawPlanResponse mirrors the Digitransit routing `plan` query result.
type rawPlanResponse struct {
	Plan *struct {
		Itineraries []struct {
			Duration     float64      `json:"duration"`
			WalkDistance float64      `json:"walkDistance"`
			StartTime    int64        `json:"startTime"`
			EndTime      int64        `json:"endTime"`
			Legs         []rawPlanLeg `json:"legs"`
		} `json:"itineraries"`
	} `json:"plan"`
}

type rawPlanLeg struct {
	ID             string `json:"id"`
	ServiceDate    string `json:"serviceDate"`
	Realtime       bool   `json:"realTime"`
	RealtimeState  string `json:"realtimeState"`
	DepartureDelay *int   `json:"departureDelay"`
	ArrivalDelay   *int   `json:"arrivalDelay"`
	Trip           *struct {
		GtfsId            string          `json:"gtfsId"`
		DirectionId       json.RawMessage `json:"directionId"`
		DepartureStoptime *struct {
			ScheduledDeparture *int `json:"scheduledDeparture"`
		} `json:"departureStoptime"`
	} `json:"trip"`
	Mode      string  `json:"mode"`
	Duration  float64 `json:"duration"`
	Distance  float64 `json:"distance"`
	StartTime int64   `json:"startTime"`
	EndTime   int64   `json:"endTime"`
	Transit   bool    `json:"transitLeg"`
	Headsign  string  `json:"headsign"`
	Route     *struct {
		GtfsId    string `json:"gtfsId"`
		ShortName string `json:"shortName"`
		LongName  string `json:"longName"`
		Color     string `json:"color"`
		Mode      string `json:"mode"`
	} `json:"route"`
	LegGeometry struct {
		Points string `json:"points"`
	} `json:"legGeometry"`
	From               rawPlanPlace   `json:"from"`
	To                 rawPlanPlace   `json:"to"`
	IntermediatePlaces []rawPlanPlace `json:"intermediatePlaces"`
}

type rawPlanPlace struct {
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	Stop *struct {
		PlatformCode string `json:"platformCode"`
		GtfsId       string `json:"gtfsId"`
		Name         string `json:"name"`
		Code         string `json:"code"`
	} `json:"stop"`
}

func toJourneyPlace(p rawPlanPlace) JourneyPlace {
	jp := JourneyPlace{Name: p.Name, Lat: p.Lat, Lon: p.Lon}
	if p.Stop != nil {
		jp.StopId = p.Stop.GtfsId
		jp.StopCode = p.Stop.Code
		jp.PlatformCode = p.Stop.PlatformCode
		if jp.Name == "" {
			jp.Name = p.Stop.Name
		}
	}
	return jp
}

// planModes maps the CSV `modes` query parameter to the transportModes input
// expected by the routing API. WALK is always included so legs can connect.
func planModes(raw string) []map[string]string {
	allowed := map[string]bool{
		"TRAM": true, "BUS": true, "RAIL": true, "SUBWAY": true, "FERRY": true,
	}
	modes := []map[string]string{{"mode": "WALK"}}
	seen := map[string]bool{}
	if strings.TrimSpace(raw) == "" {
		for m := range allowed {
			modes = append(modes, map[string]string{"mode": m})
		}
		return modes
	}
	for _, part := range strings.Split(raw, ",") {
		m := strings.ToUpper(strings.TrimSpace(part))
		if allowed[m] && !seen[m] {
			seen[m] = true
			modes = append(modes, map[string]string{"mode": m})
		}
	}
	// If nothing valid was requested, fall back to all transit modes.
	if len(modes) == 1 {
		for m := range allowed {
			modes = append(modes, map[string]string{"mode": m})
		}
	}
	return modes
}

// Plan proxies the Digitransit routing `plan` query. It answers "which routes
// take me from here to there", returning ranked itineraries with the exact
// stops the rider would board and alight at.
func (h *Handlers) Plan(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	fromLat, err1 := strconv.ParseFloat(q.Get("fromLat"), 64)
	fromLon, err2 := strconv.ParseFloat(q.Get("fromLon"), 64)
	toLat, err3 := strconv.ParseFloat(q.Get("toLat"), 64)
	toLon, err4 := strconv.ParseFloat(q.Get("toLon"), 64)
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil ||
		!validCoordinates(fromLat, fromLon) || !validCoordinates(toLat, toLon) {
		http.Error(w, "missing or invalid coordinates (fromLat, fromLon, toLat, toLon required)", http.StatusBadRequest)
		return
	}
	date, clock := q.Get("date"), q.Get("time")
	if q.Has("date") || q.Has("time") {
		d, dateErr := time.Parse("2006-01-02", date)
		t, timeErr := time.Parse("15:04", clock)
		if dateErr != nil || timeErr != nil || d.Format("2006-01-02") != date || t.Format("15:04") != clock {
			http.Error(w, "date (YYYY-MM-DD) and time (HH:mm) must both be valid Helsinki local values", http.StatusBadRequest)
			return
		}
	}

	numItineraries := 4
	if v, err := strconv.Atoi(q.Get("numItineraries")); err == nil && v > 0 && v <= 6 {
		numItineraries = v
	}
	arriveBy := q.Get("arriveBy") == "true"
	modes := planModes(q.Get("modes"))

	key := fmt.Sprintf("plan:%g,%g>%g,%g:%d:%v:%s:%s:%s",
		fromLat, fromLon, toLat, toLon, numItineraries, arriveBy, q.Get("modes"), date, clock)

	if cached, ok := h.apiCache.Get(key); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Write(cached)
		return
	}

	dataInterface, err, _ := h.sfGroup.Do(key, func() (interface{}, error) {
		if cached, ok := h.apiCache.Get(key); ok {
			return cached, nil
		}

		queryStr := `
			query PlanJourney(
				$fromLat: Float!, $fromLon: Float!,
				$toLat: Float!, $toLon: Float!,
				$numItineraries: Int!, $arriveBy: Boolean!,
				$modes: [TransportMode!], $date: String, $time: String
			) {
				plan(
					from: {lat: $fromLat, lon: $fromLon}
					to: {lat: $toLat, lon: $toLon}
					numItineraries: $numItineraries
					arriveBy: $arriveBy
					transportModes: $modes
					date: $date
					time: $time
				) {
					itineraries {
						duration
						walkDistance
						startTime
						endTime
						legs { ` + journeyLegFields + ` }
					}
				}
			}
		`

		variables := map[string]interface{}{
			"fromLat":        fromLat,
			"fromLon":        fromLon,
			"toLat":          toLat,
			"toLon":          toLon,
			"numItineraries": numItineraries,
			"arriveBy":       arriveBy,
			"modes":          modes,
		}
		// Digitransit interprets these wall-clock values in the router's
		// Europe/Helsinki timezone, not in the browser or this server's zone.
		if date != "" {
			variables["date"] = date
			variables["time"] = clock
		}

		var raw rawPlanResponse
		if err := h.gql.query(r.Context(), queryStr, variables, &raw); err != nil {
			log.Printf("GraphQL plan query error: %v", err)
			return nil, fmt.Errorf("upstream api error")
		}

		if raw.Plan == nil {
			return nil, fmt.Errorf("no plan")
		}

		resp := JourneyPlanResponse{FetchedAt: time.Now().UnixMilli(), Itineraries: make([]JourneyItinerary, 0, len(raw.Plan.Itineraries))}
		for _, it := range raw.Plan.Itineraries {
			legs := make([]JourneyLeg, 0, len(it.Legs))
			transitLegs := 0
			for _, l := range it.Legs {
				leg := toJourneyLeg(l)
				if l.Transit {
					transitLegs++
				}
				legs = append(legs, leg)
			}

			transfers := 0
			if transitLegs > 1 {
				transfers = transitLegs - 1
			}

			resp.Itineraries = append(resp.Itineraries, JourneyItinerary{
				Duration:     int(it.Duration),
				WalkDistance: it.WalkDistance,
				StartTime:    it.StartTime,
				EndTime:      it.EndTime,
				Transfers:    transfers,
				Legs:         legs,
			})
		}

		jsonBytes, err := json.Marshal(resp)
		if err != nil {
			return nil, err
		}

		h.apiCache.Set(key, jsonBytes, 20*time.Second)
		return jsonBytes, nil
	})

	if err != nil {
		if err.Error() == "no plan" {
			http.Error(w, "no journey found", http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusBadGateway)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(dataInterface.([]byte))
}
