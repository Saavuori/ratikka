package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"
)

func validCoordinates(lat, lon float64) bool {
	return !math.IsNaN(lat) && !math.IsNaN(lon) &&
		lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

func optionalTime(seconds *int) string {
	if seconds == nil || *seconds < 0 {
		return ""
	}
	return formatSeconds(*seconds)
}

func serviceTimestamp(day *int64, seconds *int) int64 {
	// serviceDay is epoch seconds at the start of the service day, while
	// stoptimes can extend past 24:00. Missing values are not Unix epoch dates.
	if day == nil || *day <= 0 || seconds == nil || *seconds < 0 ||
		*day > math.MaxInt64/1000-int64(*seconds) {
		return 0
	}
	return (*day + int64(*seconds)) * 1000
}

type NearbyStop struct {
	StopInfo
	Distance float64 `json:"distance"`
}

type NearbyStopsResponse struct {
	Stops     []NearbyStop `json:"stops"`
	FetchedAt int64        `json:"fetchedAt"`
}

func (h *Handlers) NearbyStops(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lat, latErr := strconv.ParseFloat(q.Get("lat"), 64)
	lon, lonErr := strconv.ParseFloat(q.Get("lon"), 64)
	if latErr != nil || lonErr != nil || !validCoordinates(lat, lon) {
		http.Error(w, "invalid lat or lon", http.StatusBadRequest)
		return
	}
	radius := 1000
	if q.Has("radius") {
		var err error
		radius, err = strconv.Atoi(q.Get("radius"))
		if err != nil || radius < 1 || radius > 3000 {
			http.Error(w, "radius must be between 1 and 3000 metres", http.StatusBadRequest)
			return
		}
	}
	key := fmt.Sprintf("nearby:%g:%g:%d", lat, lon, radius)
	data, err, _ := h.sfGroup.Do(key, func() (interface{}, error) {
		if cached, ok := h.apiCache.Get(key); ok {
			return cached, nil
		}
		var raw struct {
			StopsByRadius *struct {
				Edges []struct {
					Node *struct {
						Stop     *StopInfo `json:"stop"`
						Distance *float64  `json:"distance"`
					} `json:"node"`
				} `json:"edges"`
			} `json:"stopsByRadius"`
		}
		// Digitransit's distance is walking distance along streets and paths.
		const query = `query NearbyStops($lat: Float!, $lon: Float!, $radius: Int!) {
			stopsByRadius(lat: $lat, lon: $lon, radius: $radius, first: 10) {
				edges { node { stop { gtfsId name code lat lon platformCode } distance } }
			}
		}`
		if err := h.gql.query(r.Context(), query, map[string]interface{}{
			"lat": lat, "lon": lon, "radius": radius,
		}, &raw); err != nil {
			return nil, err
		}
		if raw.StopsByRadius == nil {
			return nil, fmt.Errorf("missing nearby stops")
		}
		out := NearbyStopsResponse{Stops: []NearbyStop{}, FetchedAt: time.Now().UnixMilli()}
		for _, edge := range raw.StopsByRadius.Edges {
			n := edge.Node
			if n == nil || n.Stop == nil || n.Stop.GtfsId == "" || n.Distance == nil ||
				*n.Distance < 0 || *n.Distance > float64(radius) ||
				!validCoordinates(n.Stop.Lat, n.Stop.Lon) {
				continue
			}
			out.Stops = append(out.Stops, NearbyStop{StopInfo: *n.Stop, Distance: *n.Distance})
		}
		sort.SliceStable(out.Stops, func(i, j int) bool { return out.Stops[i].Distance < out.Stops[j].Distance })
		seen := make(map[string]bool)
		stops := out.Stops[:0]
		for _, stop := range out.Stops {
			if !seen[stop.GtfsId] && len(stops) < 10 {
				seen[stop.GtfsId] = true
				stops = append(stops, stop)
			}
		}
		out.Stops = stops
		body, err := json.Marshal(out)
		if err == nil {
			h.apiCache.Set(key, body, 30*time.Second)
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
