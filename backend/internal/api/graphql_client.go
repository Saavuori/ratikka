package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

var DigitransitURLEndpoint = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1"

type GraphQLClient struct {
	apiKey     string
	httpClient *http.Client
}

func NewGraphQLClient(apiKey string) *GraphQLClient {
	return &GraphQLClient{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

type graphQLRequest struct {
	Query     string                 `json:"query"`
	Variables map[string]interface{} `json:"variables,omitempty"`
}

type graphQLErrors []struct {
	Message string `json:"message"`
}

type graphQLResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors graphQLErrors   `json:"errors,omitempty"`
}

// Raw Digitransit GraphQL Response Structs
type rawTripResponse struct {
	Trip *struct {
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
	} `json:"trip"`
}

type rawRouteInfo struct {
	ShortName string `json:"shortName"`
	LongName  string `json:"longName"`
	Mode      string `json:"mode"`
	Color     string `json:"color"`
}

type rawStopResponse struct {
	Stop *struct {
		GtfsId string  `json:"gtfsId"`
		Name   string  `json:"name"`
		Code   string  `json:"code"`
		Lat    float64 `json:"lat"`
		Lon    float64 `json:"lon"`
		Routes []struct {
			ShortName string `json:"shortName"`
			LongName  string `json:"longName"`
			Mode      string `json:"mode"`
		} `json:"routes"`
		StoptimesWithoutPatterns []struct {
			ScheduledArrival int    `json:"scheduledArrival"`
			RealtimeArrival  int    `json:"realtimeArrival"`
			ArrivalDelay     int    `json:"arrivalDelay"`
			Realtime         bool   `json:"realtime"`
			RealtimeState    string `json:"realtimeState"`
			Headsign         string `json:"headsign"`
			Trip             struct {
				GtfsId string `json:"gtfsId"`
				Route  struct {
					ShortName string `json:"shortName"`
					Color     string `json:"color"`
				} `json:"route"`
			} `json:"trip"`
		} `json:"stoptimesWithoutPatterns"`
	} `json:"stop"`
}

func (c *GraphQLClient) query(ctx context.Context, query string, variables map[string]interface{}, out interface{}) error {
	reqBody := graphQLRequest{
		Query:     query,
		Variables: variables,
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal graphql request body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", DigitransitURLEndpoint, bytes.NewBuffer(jsonBytes))
	if err != nil {
		return fmt.Errorf("failed to create http request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("digitransit-subscription-key", c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code %d", resp.StatusCode)
	}

	var gqlResp graphQLResponse
	if err := json.NewDecoder(resp.Body).Decode(&gqlResp); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	if len(gqlResp.Errors) > 0 {
		return fmt.Errorf("graphql error: %s", gqlResp.Errors[0].Message)
	}

	if err := json.Unmarshal(gqlResp.Data, out); err != nil {
		return fmt.Errorf("failed to unmarshal graphql data: %w", err)
	}

	return nil
}
