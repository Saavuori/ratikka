package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"
)

// TrafficLightsWFSEndpoint is Helsinki's open-data WFS server. It is a package
// variable so tests can point it at a mock server.
var TrafficLightsWFSEndpoint = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs"

// trafficLightLayers maps the WFS type name to the junction-kind label we
// surface to the frontend. Liikennevalot = ordinary traffic lights,
// Varoitusvalot = pedestrian/cyclist warning lights (a much smaller set).
var trafficLightLayers = map[string]string{
	"avoindata:Liikennevalot_piste": "traffic_light",
	"avoindata:Varoitusvalot_piste": "warning_light",
}

// GeoJSON output for known signalized-junction locations. This is a mostly
// static reference dataset (Helsinki traffic/street planning), not a live
// signal-state feed: it tells the frontend where a tram *could* be waiting
// on a light, not whether that light is red right now.
type trafficLightsFeatureCollection struct {
	Type     string                `json:"type"`
	Features []trafficLightFeature `json:"features"`
}

type trafficLightFeature struct {
	Type       string                 `json:"type"`
	Geometry   trafficLightGeometry   `json:"geometry"`
	Properties trafficLightProperties `json:"properties"`
}

type trafficLightGeometry struct {
	Type        string     `json:"type"`
	Coordinates [2]float64 `json:"coordinates"`
}

type trafficLightProperties struct {
	ID       int    `json:"id"`
	Type     string `json:"type"`     // "traffic_light" | "warning_light"
	Junction string `json:"junction"` // e.g. "Mannerheimintie/Runeberginkatu"
}

// rawWFSFeatureCollection mirrors the subset of the GeoServer WFS GeoJSON
// response we use.
type rawWFSFeatureCollection struct {
	Features []struct {
		Geometry struct {
			Coordinates []float64 `json:"coordinates"` // [lon, lat]
		} `json:"geometry"`
		Properties struct {
			Numero  int    `json:"numero"`
			Risteys string `json:"risteys"`
		} `json:"properties"`
	} `json:"features"`
}

func fetchTrafficLightLayer(r *http.Request, h *Handlers, typeName, kind string, out *trafficLightsFeatureCollection) error {
	params := url.Values{}
	params.Set("service", "WFS")
	params.Set("version", "2.0.0")
	params.Set("request", "GetFeature")
	params.Set("typeNames", typeName)
	params.Set("outputFormat", "application/json")
	params.Set("srsName", "EPSG:4326")

	reqURL := TrafficLightsWFSEndpoint + "?" + params.Encode()
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, reqURL, nil)
	if err != nil {
		return fmt.Errorf("failed to build WFS request: %w", err)
	}

	resp, err := h.gql.HTTPClient().Do(req)
	if err != nil {
		return fmt.Errorf("upstream api error")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		log.Printf("traffic-lights WFS upstream status %d for %s: %s", resp.StatusCode, typeName, string(body))
		return fmt.Errorf("upstream api error")
	}

	var raw rawWFSFeatureCollection
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return fmt.Errorf("failed to decode WFS response: %w", err)
	}

	for _, f := range raw.Features {
		if len(f.Geometry.Coordinates) < 2 {
			continue
		}
		out.Features = append(out.Features, trafficLightFeature{
			Type:     "Feature",
			Geometry: trafficLightGeometry{Type: "Point", Coordinates: [2]float64{f.Geometry.Coordinates[0], f.Geometry.Coordinates[1]}},
			Properties: trafficLightProperties{
				ID:       f.Properties.Numero,
				Type:     kind,
				Junction: f.Properties.Risteys,
			},
		})
	}

	return nil
}

// TrafficLights returns every known signalized-junction location in Helsinki
// (traffic lights + pedestrian/cyclist warning lights) as a GeoJSON
// FeatureCollection. This is Helsinki open data (CC BY 4.0, Helsingin
// kaupunkiympäristön toimiala / Kaupunkimittauspalvelut) and changes rarely,
// so it's cached for a full day rather than refetched per request.
func (h *Handlers) TrafficLights(w http.ResponseWriter, r *http.Request) {
	const key = "traffic-lights:all"

	if cached, ok := h.apiCache.Get(key); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Write(cached)
		return
	}

	dataInterface, err, _ := h.sfGroup.Do(key, func() (interface{}, error) {
		if cached, ok := h.apiCache.Get(key); ok {
			return cached, nil
		}

		fc := trafficLightsFeatureCollection{
			Type:     "FeatureCollection",
			Features: make([]trafficLightFeature, 0, 600),
		}

		for typeName, kind := range trafficLightLayers {
			if err := fetchTrafficLightLayer(r, h, typeName, kind, &fc); err != nil {
				log.Printf("traffic-lights layer %s fetch error: %v\n", typeName, err)
				return nil, err
			}
		}

		jsonBytes, err := json.Marshal(fc)
		if err != nil {
			return nil, err
		}

		h.apiCache.Set(key, jsonBytes, 24*time.Hour)
		return jsonBytes, nil
	})

	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(dataInterface.([]byte))
}
