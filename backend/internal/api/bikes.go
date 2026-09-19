package api

import (
	"log"
	"net/http"
	"strings"
	"time"
)

// City bikes: one station's live counts, and every station as GeoJSON.

type BikeStationDetailsResponse struct {
	StationId       string `json:"stationId"`
	Name            string `json:"name"`
	AllowPickup     bool   `json:"allowPickup"`
	AllowDropoff    bool   `json:"allowDropoff"`
	BikesAvailable  int    `json:"bikesAvailable"`
	SpacesAvailable int    `json:"spacesAvailable"`
}

// rawRentalEntityCounts mirrors Digitransit's RentalVehicleEntityCounts type,
// used for both availableVehicles and availableSpaces.
type rawRentalEntityCounts struct {
	Total  int `json:"total"`
	ByType []struct {
		Count       int `json:"count"`
		VehicleType struct {
			FormFactor string `json:"formFactor"`
		} `json:"vehicleType"`
	} `json:"byType"`
}

type rawBikeStationResponse struct {
	VehicleRentalStation *struct {
		StationId         string                 `json:"stationId"`
		Name              string                 `json:"name"`
		AllowPickup       bool                   `json:"allowPickup"`
		AllowDropoff      bool                   `json:"allowDropoff"`
		AvailableVehicles *rawRentalEntityCounts `json:"availableVehicles"`
		AvailableSpaces   *rawRentalEntityCounts `json:"availableSpaces"`
	} `json:"vehicleRentalStation"`
}

// countBicycles resolves the number of bikes (or free docks) at a station.
//
// The per-type breakdown is preferred, counting BICYCLE entries as well as
// untyped entries — empty docks in HSL's GBFS feed frequently carry no form
// factor. When the breakdown is absent entirely (HSL reports only a station
// total for docks), it falls back to the authoritative total so free docks
// don't incorrectly read as 0.
func countBicycles(counts *rawRentalEntityCounts) int {
	if counts == nil {
		return 0
	}

	sum := 0
	for _, bt := range counts.ByType {
		ff := strings.ToUpper(bt.VehicleType.FormFactor)
		if ff == "BICYCLE" || ff == "" {
			sum += bt.Count
		}
	}

	if sum == 0 {
		return counts.Total
	}
	return sum
}

func (h *Handlers) BikeStationDetails(w http.ResponseWriter, r *http.Request) {
	stationId := r.PathValue("stationId")
	if stationId == "" {
		http.Error(w, "missing stationId", http.StatusBadRequest)
		return
	}

	key := "bike:" + stationId

	serveCached(h, w, key, 15*time.Second, func() (BikeStationDetailsResponse, error) {

		queryStr := `
			query GetBikeStationDetails($stationId: String!) {
				vehicleRentalStation(id: $stationId) {
					stationId
					name
					allowPickup
					allowDropoff
					availableVehicles {
						total
						byType {
							count
							vehicleType {
								formFactor
							}
						}
					}
					availableSpaces {
						total
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
			return BikeStationDetailsResponse{}, errUpstream
		}

		if raw.VehicleRentalStation == nil {
			return BikeStationDetailsResponse{}, notFound("bike station not found")
		}

		s := raw.VehicleRentalStation
		bikes := countBicycles(s.AvailableVehicles)
		spaces := countBicycles(s.AvailableSpaces)

		resp := BikeStationDetailsResponse{
			StationId:       s.StationId,
			Name:            s.Name,
			AllowPickup:     s.AllowPickup,
			AllowDropoff:    s.AllowDropoff,
			BikesAvailable:  bikes,
			SpacesAvailable: spaces,
		}

		return resp, nil
	})
}

// GeoJSON output for the full set of city-bike stations, consumed by the map
// to draw live availability markers. Keeping the payload as GeoJSON lets the
// frontend feed it straight into a MapLibre source without reshaping.
type bikeStationsFeatureCollection struct {
	Type     string               `json:"type"`
	Features []bikeStationFeature `json:"features"`
}

type bikeStationFeature struct {
	Type       string                `json:"type"`
	Geometry   bikeStationGeometry   `json:"geometry"`
	Properties bikeStationProperties `json:"properties"`
}

type bikeStationGeometry struct {
	Type        string     `json:"type"`
	Coordinates [2]float64 `json:"coordinates"`
}

type bikeStationProperties struct {
	StationId       string `json:"stationId"`
	Name            string `json:"name"`
	BikesAvailable  int    `json:"bikesAvailable"`
	SpacesAvailable int    `json:"spacesAvailable"`
	AllowPickup     bool   `json:"allowPickup"`
	AllowDropoff    bool   `json:"allowDropoff"`
}

type rawBikeStationsResponse struct {
	VehicleRentalStations []struct {
		StationId         string                 `json:"stationId"`
		Name              string                 `json:"name"`
		Lat               float64                `json:"lat"`
		Lon               float64                `json:"lon"`
		AllowPickup       bool                   `json:"allowPickup"`
		AllowDropoff      bool                   `json:"allowDropoff"`
		AvailableVehicles *rawRentalEntityCounts `json:"availableVehicles"`
		AvailableSpaces   *rawRentalEntityCounts `json:"availableSpaces"`
	} `json:"vehicleRentalStations"`
}

// BikeStations returns every HSL city-bike station as a GeoJSON FeatureCollection
// with live bike/dock counts. The map renders availability markers from this so
// the on-map counts come from the authoritative realtime API rather than the
// static vector tiles (which carry no live availability).
func (h *Handlers) BikeStations(w http.ResponseWriter, r *http.Request) {
	const key = "bike:stations:all"

	serveCached(h, w, key, 20*time.Second, func() (bikeStationsFeatureCollection, error) {

		queryStr := `
			query GetBikeStations {
				vehicleRentalStations {
					stationId
					name
					lat
					lon
					allowPickup
					allowDropoff
					availableVehicles {
						total
						byType {
							count
							vehicleType {
								formFactor
							}
						}
					}
					availableSpaces {
						total
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

		var raw rawBikeStationsResponse
		if err := h.gql.query(r.Context(), queryStr, nil, &raw); err != nil {
			log.Printf("GraphQL query error for bike stations: %v\n", err)
			return bikeStationsFeatureCollection{}, errUpstream
		}

		fc := bikeStationsFeatureCollection{
			Type:     "FeatureCollection",
			Features: make([]bikeStationFeature, 0, len(raw.VehicleRentalStations)),
		}
		for _, s := range raw.VehicleRentalStations {
			// Stations without coordinates can't be placed on the map.
			if s.Lat == 0 && s.Lon == 0 {
				continue
			}
			fc.Features = append(fc.Features, bikeStationFeature{
				Type:     "Feature",
				Geometry: bikeStationGeometry{Type: "Point", Coordinates: [2]float64{s.Lon, s.Lat}},
				Properties: bikeStationProperties{
					StationId:       s.StationId,
					Name:            s.Name,
					BikesAvailable:  countBicycles(s.AvailableVehicles),
					SpacesAvailable: countBicycles(s.AvailableSpaces),
					AllowPickup:     s.AllowPickup,
					AllowDropoff:    s.AllowDropoff,
				},
			})
		}

		return fc, nil
	})
}

// Disruption Alert Output Structs
