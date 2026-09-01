package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/prometheus/client_golang/prometheus"
	"ratikka/internal/cache"
)

var (
	ActiveClientsGauge = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "ratikka_active_websocket_clients",
		Help: "Number of active WebSocket clients connected to the hub.",
	})
)

func init() {
	prometheus.MustRegister(ActiveClientsGauge)
}


// ModeController lets the hub turn on-demand ingestion of an optional vehicle
// mode on and off based on whether any connected client currently wants to see
// it. Trams always stream; buses, metro and commuter trains are opt-in.
type ModeController interface {
	EnableMode(mode string)
	DisableMode(mode string)
}

// optionalModes are the modes a client can switch on and off. Anything else a
// client asks for is ignored (the ingestion worker rejects unknown modes too).
var optionalModes = []string{"bus", "metro", "train"}

func isOptionalMode(mode string) bool {
	for _, m := range optionalModes {
		if m == mode {
			return true
		}
	}
	return false
}

type Client struct {
	conn *websocket.Conn
	send chan []byte
	// wantsModes holds the optional modes this client has opted in to.
	// Guarded by Hub.clientsMu.
	wantsModes map[string]bool
}

type Hub struct {
	cache     cache.Cache
	clients   map[*Client]bool
	clientsMu sync.RWMutex

	// modeCtl toggles on-demand ingestion of the optional modes. modeDemand
	// counts, per mode, how many connected clients currently want it; ingestion
	// is enabled for a mode while its count is > 0. Both are guarded by
	// clientsMu.
	modeCtl    ModeController
	modeDemand map[string]int
}

type PositionsMessage struct {
	Type      string                     `json:"type"`
	Timestamp string                     `json:"timestamp"`
	Vehicles  map[string]json.RawMessage `json:"vehicles"`
	Count     int                        `json:"count"`
}

func NewHub(c cache.Cache) *Hub {
	return &Hub{
		cache:      c,
		clients:    make(map[*Client]bool),
		modeDemand: make(map[string]int),
	}
}

// SetModeController wires the ingestion worker that the hub toggles based on
// client demand for the optional modes. Call once before Run.
func (h *Hub) SetModeController(ctl ModeController) {
	h.modeCtl = ctl
}

// setClientModePref records whether a client wants an optional mode and toggles
// ingestion on that mode's 0->1 / 1->0 demand boundaries. The controller call
// happens outside clientsMu because EnableMode/DisableMode may block on an MQTT
// round-trip.
func (h *Hub) setClientModePref(client *Client, mode string, want bool) {
	if !isOptionalMode(mode) {
		return
	}

	var enable, disable bool
	h.clientsMu.Lock()
	if _, ok := h.clients[client]; ok && want != client.wantsModes[mode] {
		if client.wantsModes == nil {
			client.wantsModes = make(map[string]bool)
		}
		client.wantsModes[mode] = want
		if want {
			if h.modeDemand[mode] == 0 {
				enable = true
			}
			h.modeDemand[mode]++
		} else {
			h.modeDemand[mode]--
			if h.modeDemand[mode] <= 0 {
				h.modeDemand[mode] = 0
				disable = true
			}
		}
	}
	h.clientsMu.Unlock()

	if h.modeCtl == nil {
		return
	}
	if enable {
		h.modeCtl.EnableMode(mode)
	} else if disable {
		h.modeCtl.DisableMode(mode)
	}
}

func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(1000 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.broadcastSnapshot(ctx)
		}
	}
}

func (h *Hub) addClient(client *Client) {
	h.clientsMu.Lock()
	h.clients[client] = true
	ActiveClientsGauge.Set(float64(len(h.clients)))
	h.clientsMu.Unlock()
}

// removeClient deletes the client and closes its send channel exactly once.
// Safe to call from both the connection handler and the broadcast loop. Any
// optional modes the client wanted release their demand, and ingestion may be
// disabled for the ones nobody else wants.
func (h *Hub) removeClient(client *Client) {
	var disable []string
	h.clientsMu.Lock()
	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		close(client.send)
		for mode, want := range client.wantsModes {
			if !want {
				continue
			}
			client.wantsModes[mode] = false
			h.modeDemand[mode]--
			if h.modeDemand[mode] <= 0 {
				h.modeDemand[mode] = 0
				disable = append(disable, mode)
			}
		}
	}
	ActiveClientsGauge.Set(float64(len(h.clients)))
	h.clientsMu.Unlock()

	if h.modeCtl == nil {
		return
	}
	for _, mode := range disable {
		h.modeCtl.DisableMode(mode)
	}
}

func (h *Hub) broadcastSnapshot(ctx context.Context) {
	h.clientsMu.RLock()
	clientCount := len(h.clients)
	h.clientsMu.RUnlock()

	// If no clients connected, don't query the cache or serialize
	if clientCount == 0 {
		return
	}

	positions, err := h.cache.GetAllPositions(ctx)
	if err != nil {
		log.Printf("WS Hub error getting positions: %v\n", err)
		return
	}

	vehicles := make(map[string]json.RawMessage, len(positions))
	for k, v := range positions {
		vehicles[k] = json.RawMessage(v)
	}

	msg := PositionsMessage{
		Type:      "positions",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Vehicles:  vehicles,
		Count:     len(vehicles),
	}

	payload, err := json.Marshal(msg)
	if err != nil {
		log.Printf("WS Hub error marshaling positions message: %v\n", err)
		return
	}

	var stuck []*Client
	h.clientsMu.RLock()
	for client := range h.clients {
		select {
		case client.send <- payload:
		default:
			stuck = append(stuck, client)
		}
	}
	h.clientsMu.RUnlock()

	// A full send buffer means the client is ~16s behind; disconnect it
	// rather than letting it linger while receiving nothing.
	for _, client := range stuck {
		log.Println("WS Hub: dropping client with full send buffer")
		h.removeClient(client)
		if client.conn != nil {
			client.conn.Close(websocket.StatusPolicyViolation, "slow consumer")
		}
	}
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Accept WebSocket connection
	opts := &websocket.AcceptOptions{
		InsecureSkipVerify: true, // Allow cross-origin requests for the streaming API
	}
	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		log.Printf("WS Accept error: %v\n", err)
		return
	}

	client := &Client{
		conn:       conn,
		send:       make(chan []byte, 16),
		wantsModes: make(map[string]bool),
	}

	h.addClient(client)

	// Background writer for client
	ctx, cancel := context.WithCancel(r.Context())
	defer func() {
		cancel()
		h.removeClient(client)
		client.conn.Close(websocket.StatusGoingAway, "closing")
	}()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-client.send:
				if !ok {
					return
				}
				writeCtx, writeCancel := context.WithTimeout(ctx, 3*time.Second)
				err := client.conn.Write(writeCtx, websocket.MessageText, msg)
				writeCancel()
				if err != nil {
					log.Printf("WS Write error: %v\n", err)
					return
				}
			}
		}
	}()

	// Read loop: detect disconnects and handle client control messages.
	// Clients send {"modes": {"bus": true, "metro": false, ...}} to opt in/out
	// of the optional feeds, which drives on-demand ingestion in the hub.
	// {"buses": true|false} is the older single-mode form, still accepted.
	for {
		_, data, err := conn.Read(r.Context())
		if err != nil {
			log.Printf("WS Connection closed or error: %v\n", err)
			break
		}

		var ctrl struct {
			Buses *bool           `json:"buses"`
			Modes map[string]bool `json:"modes"`
		}
		if err := json.Unmarshal(data, &ctrl); err != nil {
			continue
		}
		if ctrl.Buses != nil {
			h.setClientModePref(client, "bus", *ctrl.Buses)
		}
		for mode, want := range ctrl.Modes {
			h.setClientModePref(client, mode, want)
		}
	}
}
