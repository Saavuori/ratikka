package api

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"
)

// Service alerts, in the reader's own language where HSL publishes one.

type AlertsListResponse struct {
	Alerts []AlertResponse `json:"alerts"`
}

type AlertResponse struct {
	Feed            string                `json:"feed"`
	SeverityLevel   string                `json:"severityLevel"`
	Effect          string                `json:"effect"`
	Cause           string                `json:"cause"`
	HeaderText      string                `json:"headerText"`
	DescriptionText string                `json:"descriptionText"`
	Url             string                `json:"url"`
	StartDate       int64                 `json:"startDate"`
	EndDate         int64                 `json:"endDate"`
	Entities        []AlertEntityResponse `json:"entities"`
}

type AlertEntityResponse struct {
	Type      string `json:"type"`                // "Route" or "Stop"
	GtfsId    string `json:"gtfsId"`              // "HSL:1006"
	ShortName string `json:"shortName,omitempty"` // e.g. "6"
	Mode      string `json:"mode,omitempty"`      // e.g. "TRAM"
	Name      string `json:"name,omitempty"`      // e.g. "Senaatintori"
	Code      string `json:"code,omitempty"`      // e.g. "H1234"
}

func (h *Handlers) Alerts(w http.ResponseWriter, r *http.Request) {
	// Normalize language code
	lang := "fi"
	acceptLang := r.Header.Get("Accept-Language")
	if strings.HasPrefix(acceptLang, "en") {
		lang = "en"
	} else if strings.HasPrefix(acceptLang, "sv") {
		lang = "sv"
	}

	key := "alerts:" + lang

	// Fetch from Digitransit GraphQL API
	queryStr := `
		query GetServiceAlerts {
			alerts {
				feed
				alertSeverityLevel
				alertEffect
				alertCause
				alertHeaderText
				alertDescriptionText
				alertUrl
				effectiveStartDate
				effectiveEndDate
				entities {
					__typename
					... on Route {
						gtfsId
						shortName
						mode
					}
					... on Stop {
						gtfsId
						name
						code
					}
				}
			}
		}
	`

	serveCached(h, w, key, 60*time.Second, func() (AlertsListResponse, error) {

		// Context with the accept-language value
		ctx := context.WithValue(r.Context(), AcceptLanguageKey, lang)

		var raw rawAlertResponse
		if err := h.gql.query(ctx, queryStr, nil, &raw); err != nil {
			log.Printf("GraphQL query error for alerts: %v\n", err)
			return AlertsListResponse{}, errUpstream
		}

		// Map rawAlerts to AlertResponse
		alerts := make([]AlertResponse, 0, len(raw.Alerts))
		for _, ra := range raw.Alerts {
			entities := make([]AlertEntityResponse, 0, len(ra.Entities))
			for _, re := range ra.Entities {
				entities = append(entities, AlertEntityResponse{
					Type:      re.Typename,
					GtfsId:    re.GtfsId,
					ShortName: re.ShortName,
					Mode:      re.Mode,
					Name:      re.Name,
					Code:      re.Code,
				})
			}

			alerts = append(alerts, AlertResponse{
				Feed:            ra.Feed,
				SeverityLevel:   ra.AlertSeverityLevel,
				Effect:          ra.AlertEffect,
				Cause:           ra.AlertCause,
				HeaderText:      ra.AlertHeaderText,
				DescriptionText: ra.AlertDescriptionText,
				Url:             ra.AlertUrl,
				StartDate:       ra.EffectiveStartDate,
				EndDate:         ra.EffectiveEndDate,
				Entities:        entities,
			})
		}

		return AlertsListResponse{Alerts: alerts}, nil
	})
}
