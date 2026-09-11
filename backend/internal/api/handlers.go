package api

import (
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
	"ratikka/internal/cache"
	"ratikka/internal/replay"
)

var (
	Version   = "dev"
	BuildDate = "unknown"
	GitCommit = "unknown"
)

var startTime = time.Now()

// responseCacheItem represents a cached HTTP response payload
type responseCacheItem struct {
	data      []byte
	expiresAt time.Time
}

// ResponseCache is a thread-safe in-memory cache for API payloads
type ResponseCache struct {
	mu        sync.RWMutex
	items     map[string]responseCacheItem
	lastSweep time.Time
}

func NewResponseCache() *ResponseCache {
	return &ResponseCache{
		items: make(map[string]responseCacheItem),
	}
}

func (c *ResponseCache) Get(key string) ([]byte, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	item, ok := c.items[key]
	if !ok || time.Now().After(item.expiresAt) {
		return nil, false
	}
	return item.data, true
}

func (c *ResponseCache) Set(key string, data []byte, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	// Opportunistically evict expired entries so keys derived from unbounded
	// user input (geocode text, plan coordinates) cannot grow the map forever.
	if now.Sub(c.lastSweep) > 5*time.Minute {
		for k, item := range c.items {
			if now.After(item.expiresAt) {
				delete(c.items, k)
			}
		}
		c.lastSweep = now
	}
	c.items[key] = responseCacheItem{
		data:      data,
		expiresAt: now.Add(ttl),
	}
}

type Handlers struct {
	cache cache.Cache
	gql   *GraphQLClient
	mqtt  interface {
		IsConnected() bool
	}
	// Caching and request coalescing for upstream API queries
	apiCache *ResponseCache
	sfGroup  *singleflight.Group
	// archive is the rolling history the replay endpoints read. Nil when no
	// history is being recorded, which those endpoints report rather than
	// failing on.
	archive *replay.Archive
}

func NewHandlers(c cache.Cache, gql *GraphQLClient, mqtt interface{ IsConnected() bool }) *Handlers {
	return &Handlers{
		cache:    c,
		gql:      gql,
		mqtt:     mqtt,
		apiCache: NewResponseCache(),
		sfGroup:  &singleflight.Group{},
	}
}

// Health Response
type HealthResponse struct {
	Status         string `json:"status"`
	MQTTConnected  bool   `json:"mqtt_connected"`
	RedisConnected bool   `json:"redis_connected"`
	ActiveVehicles int    `json:"active_vehicles"`
	UptimeSeconds  int64  `json:"uptime_seconds"`
}

func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	redisConnected := h.cache.Ping(r.Context()) == nil
	mqttConnected := h.mqtt.IsConnected()

	activeVehicles := 0
	if positions, err := h.cache.GetAllPositions(r.Context()); err == nil {
		activeVehicles = len(positions)
	}

	res := HealthResponse{
		Status:         "healthy",
		MQTTConnected:  mqttConnected,
		RedisConnected: redisConnected,
		ActiveVehicles: activeVehicles,
		UptimeSeconds:  int64(time.Since(startTime).Seconds()),
	}

	if !redisConnected || !mqttConnected {
		res.Status = "degraded"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

// Version Response
type VersionResponse struct {
	Version   string `json:"version"`
	BuildDate string `json:"build_date"`
	GitCommit string `json:"git_sha"`
}

func (h *Handlers) Version(w http.ResponseWriter, r *http.Request) {
	res := VersionResponse{
		Version:   Version,
		BuildDate: BuildDate,
		GitCommit: GitCommit,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

// Config Response
type ConfigResponse struct {
	DigitransitMapKey string `json:"digitransit_map_key"`
	// Key for the National Land Survey's open map image service, which serves
	// the orthophoto basemap behind the map's satellite mode. Empty when none
	// is configured, and the frontend then leaves that mode out entirely.
	MMLApiKey string `json:"mml_api_key"`
}

func (h *Handlers) Config(w http.ResponseWriter, r *http.Request) {
	// The frontend needs a subscription key for map tile requests, so a key is
	// necessarily public. Prefer a dedicated (rate-limited / map-only) key via
	// DIGITRANSIT_MAP_API_KEY so the server-side routing key stays private.
	mapKey := os.Getenv("DIGITRANSIT_MAP_API_KEY")
	if mapKey == "" {
		mapKey = os.Getenv("DIGITRANSIT_API_KEY")
	}
	res := ConfigResponse{
		DigitransitMapKey: mapKey,
		// Same story: MML's open interface authenticates on the query string,
		// so a browser-side key is necessarily public. It is a free,
		// rate-limited open data key, not a billing credential.
		MMLApiKey: os.Getenv("MML_API_KEY"),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

// Trip Details Output Structs
