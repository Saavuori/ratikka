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


type Client struct {
	conn *websocket.Conn
	send chan []byte
}

type Hub struct {
	cache     cache.Cache
	clients   map[*Client]bool
	clientsMu sync.RWMutex
}

type PositionsMessage struct {
	Type      string                     `json:"type"`
	Timestamp string                     `json:"timestamp"`
	Vehicles  map[string]json.RawMessage `json:"vehicles"`
	Count     int                        `json:"count"`
}

func NewHub(c cache.Cache) *Hub {
	return &Hub{
		cache:   c,
		clients: make(map[*Client]bool),
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
// Safe to call from both the connection handler and the broadcast loop.
func (h *Hub) removeClient(client *Client) {
	h.clientsMu.Lock()
	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		close(client.send)
	}
	ActiveClientsGauge.Set(float64(len(h.clients)))
	h.clientsMu.Unlock()
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
		conn: conn,
		send: make(chan []byte, 16),
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

	// Read loop to detect disconnects / ping-pong
	for {
		_, _, err := conn.Read(r.Context())
		if err != nil {
			log.Printf("WS Connection closed or error: %v\n", err)
			break
		}
	}
}
