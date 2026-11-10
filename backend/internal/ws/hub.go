package ws

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
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
// it. Trams always stream; buses, metro, commuter trains and ferries are opt-in.
type ModeController interface {
	EnableMode(mode string)
	DisableMode(mode string)
}

// optionalModes are the modes a client can switch on and off. Anything else a
// client asks for is ignored (the ingestion worker rejects unknown modes too).
var optionalModes = []string{"bus", "metro", "train", "ferry"}

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

// PositionsMessage is the shape of one broadcast. It is encoded by hand in
// snapshot.payload, which splices the cached records in verbatim; this type
// is what a reader decodes it into.
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

// broadcastSnapshot sends every client the current positions of the vehicles
// it asked for: trams always, plus whichever optional modes it has opted in to.
//
// Ingestion is shared, so while any one client has buses on, the cache holds
// the whole bus fleet — several hundred vehicles, five or six times the bytes
// of the trams. Sending that to every client made a tram-only reader download,
// parse and throw away the buses someone else wanted, every second. Clients
// that want the same modes get the same bytes, so a payload is built once per
// distinct set of modes, not once per client.
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

	snap := newSnapshot(positions, time.Now())
	payloads := make(map[string][]byte)

	var stuck []*Client
	h.clientsMu.RLock()
	for client := range h.clients {
		key := modesKey(client.wantsModes)
		payload, ok := payloads[key]
		if !ok {
			payload = snap.payload(client.wantsModes)
			payloads[key] = payload
		}
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

// modesKey names the set of optional modes a client wants, so clients that
// want the same ones can share a payload.
func modesKey(wants map[string]bool) string {
	var b strings.Builder
	for _, mode := range optionalModes {
		if wants[mode] {
			b.WriteString(mode)
			b.WriteByte(',')
		}
	}
	return b.String()
}

// snapshot is one tick's positions, decoded just far enough to be filtered by
// mode and re-encoded without going through encoding/json again.
type snapshot struct {
	timestamp string
	vehicles  []snapshotVehicle
	size      int // bytes of every vehicle's key and record together
}

type snapshotVehicle struct {
	key  []byte // the vehicle ID, already JSON-quoted
	mode string
	raw  []byte
}

func newSnapshot(positions map[string][]byte, now time.Time) *snapshot {
	ids := make([]string, 0, len(positions))
	for id := range positions {
		ids = append(ids, id)
	}
	// Sorted, as encoding/json sorts map keys: the same feed always reads as
	// the same bytes.
	sort.Strings(ids)

	s := &snapshot{
		timestamp: now.UTC().Format(time.RFC3339),
		vehicles:  make([]snapshotVehicle, 0, len(ids)),
	}
	for _, id := range ids {
		raw := positions[id]
		// Spliced in verbatim, so a record that is not valid JSON would
		// corrupt the whole message; encoding/json used to catch that while
		// marshalling, and this is the same check.
		if !json.Valid(raw) {
			log.Printf("WS Hub: skipping vehicle %s with unreadable cached position\n", id)
			continue
		}
		key, err := json.Marshal(id)
		if err != nil {
			continue
		}
		s.vehicles = append(s.vehicles, snapshotVehicle{key: key, mode: recordMode(raw), raw: raw})
		s.size += len(key) + len(raw) + 2
	}
	return s
}

var modeField = []byte(`"mode":"`)

// recordMode reads the mode out of a cached position without decoding the rest
// of it. The records are written by ingestion's json.Marshal, which puts the
// top-level "mode" before any nested object and emits no whitespace, and in
// valid JSON the byte sequence "mode":" cannot occur inside a string value —
// its quotes would have to be escaped. A record with no mode reads as "",
// which is never filtered out.
func recordMode(raw []byte) string {
	i := bytes.Index(raw, modeField)
	if i < 0 {
		return ""
	}
	rest := raw[i+len(modeField):]
	end := bytes.IndexByte(rest, '"')
	if end < 0 {
		return ""
	}
	return string(rest[:end])
}

// payload encodes the positions message for a client wanting the given
// optional modes. A vehicle in any other mode — trams, and anything the feed
// names that is not one of the optional modes — is always included.
func (s *snapshot) payload(wants map[string]bool) []byte {
	var b bytes.Buffer
	b.Grow(s.size + 128)
	b.WriteString(`{"type":"positions","timestamp":"`)
	b.WriteString(s.timestamp)
	b.WriteString(`","vehicles":{`)
	count := 0
	for _, v := range s.vehicles {
		if isOptionalMode(v.mode) && !wants[v.mode] {
			continue
		}
		if count > 0 {
			b.WriteByte(',')
		}
		b.Write(v.key)
		b.WriteByte(':')
		b.Write(v.raw)
		count++
	}
	b.WriteString(`},"count":`)
	b.WriteString(strconv.Itoa(count))
	b.WriteByte('}')
	return b.Bytes()
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Accept WebSocket connection
	opts := &websocket.AcceptOptions{
		InsecureSkipVerify: true, // Allow cross-origin requests for the streaming API
		// The positions message is repetitive JSON and compresses about five
		// to one (57 KB of trams to ~12 KB, the full fleet from ~330 KB to
		// ~70 KB), sent every second for as long as the map is open — most of
		// it to phones. No context takeover keeps the per-connection memory
		// flat: compressors come from a shared pool instead of each connection
		// holding its own window for its whole life. A browser that does not
		// offer permessage-deflate is served uncompressed, exactly as before.
		CompressionMode: websocket.CompressionNoContextTakeover,
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
