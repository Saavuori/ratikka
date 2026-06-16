package api

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"ratikka/internal/ws"
)

func NewRouter(h *Handlers, hub *ws.Hub) *http.ServeMux {
	mux := http.NewServeMux()

	// REST API Endpoints
	mux.HandleFunc("GET /api/v1/health", h.Health)
	mux.HandleFunc("GET /api/v1/version", h.Version)
	mux.HandleFunc("GET /api/v1/config", h.Config)
	mux.HandleFunc("GET /api/v1/trip/{tripId}", h.TripDetails)
	mux.HandleFunc("GET /api/v1/stop/{stopId}", h.StopDetails)
	mux.HandleFunc("GET /api/v1/route/{shortName}", h.RouteDetails)
	mux.HandleFunc("GET /api/v1/bike-station/{stationId}", h.BikeStationDetails)

	// Metrics Endpoint
	mux.Handle("GET /metrics", promhttp.Handler())

	// WebSocket Streaming Endpoint
	mux.Handle("GET /api/v1/stream", hub)

	// Static Frontend fallback
	mux.HandleFunc("/", ServeStatic)

	return mux
}
