package api

import (
	"net/http"
	"ratikka/internal/ws"
)

func NewRouter(h *Handlers, hub *ws.Hub) *http.ServeMux {
	mux := http.NewServeMux()

	// REST API Endpoints
	mux.HandleFunc("GET /api/v1/health", h.Health)
	mux.HandleFunc("GET /api/v1/version", h.Version)
	mux.HandleFunc("GET /api/v1/trip/{tripId}", h.TripDetails)
	mux.HandleFunc("GET /api/v1/stop/{stopId}", h.StopDetails)

	// WebSocket Streaming Endpoint
	mux.Handle("GET /api/v1/stream", hub)

	// Static Frontend fallback
	mux.HandleFunc("/", ServeStatic)

	return mux
}
