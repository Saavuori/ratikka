package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

type rawRouteInfo struct {
	ShortName string `json:"shortName"`
	LongName  string `json:"longName"`
	Mode      string `json:"mode"`
	Color     string `json:"color"`
}

type rawTripResponse struct {
	Trip *struct {
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
	} `json:"trip"`
}

type graphQLResponse struct {
	Data json.RawMessage `json:"data"`
}

func main() {
	query := `query {
		trip(id: "HSL:1007_20260615_Ma_1_1912") {
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
	}`
	reqBody, _ := json.Marshal(map[string]string{"query": query})

	req, err := http.NewRequest("POST", "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1", bytes.NewBuffer(reqBody))
	if err != nil {
		panic(err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("digitransit-subscription-key", os.Getenv("DIGITRANSIT_API_KEY"))

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	var gqlResp graphQLResponse
	if err := json.NewDecoder(resp.Body).Decode(&gqlResp); err != nil {
		panic(err)
	}

	var raw rawTripResponse
	if err := json.Unmarshal(gqlResp.Data, &raw); err != nil {
		panic(err)
	}

	fmt.Printf("Successfully unmarshaled. Trip GTFS ID: %s, Route: %s, Stops count: %d\n",
		raw.Trip.GtfsId, raw.Trip.Route.ShortName, len(raw.Trip.Stoptimes))
}
