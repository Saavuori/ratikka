package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"ratikka/internal/cache"
)

type Client struct {
	conn *websocket.Conn
	send chan []byte
}

type Hub struct {
	cache      cache.Cache
	clients    map[*Client]bool
	clientsMu  sync.RWMutex
	register   chan *Client
	unregister chan *Client
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
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(1000 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case client := <-h.register:
			h.clientsMu.Lock()
			h.clients[client] = true
			h.clientsMu.Unlock()
		case client := <-h.unregister:
			h.clientsMu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.clientsMu.Unlock()
		case <-ticker.C:
			h.broadcastSnapshot(ctx)
		}
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

	h.clientsMu.RLock()
	defer h.clientsMu.RUnlock()

	for client := range h.clients {
		select {
		case client.send <- payload:
		default:
			// Client channel full, skip or trigger unregister
			log.Println("WS Hub: client send channel full, skipping client")
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

	h.register <- client

	// Background writer for client
	ctx, cancel := context.WithCancel(r.Context())
	defer func() {
		cancel()
		h.unregister <- client
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
			// Expected when connection is closed
			break
		}
	}
}
