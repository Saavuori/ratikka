package ws

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"ratikka/internal/cache"
)

func TestHub_RegisterAndBroadcast(t *testing.T) {
	memCache := cache.NewMemoryCache()
	hub := NewHub(memCache)

	// Add dummy vehicle in cache
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	payload := []byte(`{"veh":229,"desi":"9","lat":60.1,"lng":24.9,"hdg":180,"spd":5.5,"dl":0,"drst":0,"route":"HSL:1009","stop":null,"ts":1781461815}`)
	memCache.SetPosition(ctx, "229", payload)

	// Start hub Run loop in background
	go hub.Run(ctx)

	// Register a mock client
	client := &Client{
		conn: nil,
		send: make(chan []byte, 10),
	}

	hub.addClient(client)

	// Force a broadcast manually
	hub.broadcastSnapshot(ctx)

	// Check if client received the message
	select {
	case msgBytes, ok := <-client.send:
		if !ok {
			t.Fatal("client send channel was closed")
		}

		var msg PositionsMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			t.Fatalf("failed to unmarshal broadcast message: %v", err)
		}

		if msg.Type != "positions" {
			t.Errorf("expected msg type 'positions', got %q", msg.Type)
		}
		if msg.Count != 1 {
			t.Errorf("expected count 1, got %d", msg.Count)
		}
		cachedVal, exists := msg.Vehicles["229"]
		if !exists {
			t.Fatal("expected vehicle 229 in broadcast message")
		}

		var veh map[string]interface{}
		if err := json.Unmarshal(cachedVal, &veh); err != nil {
			t.Fatalf("failed to parse vehicle json: %v", err)
		}
		if veh["desi"] != "9" {
			t.Errorf("expected desi '9', got %v", veh["desi"])
		}

	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for client to receive broadcast")
	}

	// Test unregister
	hub.removeClient(client)

	// Verify client send is closed
	select {
	case _, ok := <-client.send:
		if ok {
			t.Error("expected client send channel to be closed after unregister")
		}
	case <-time.After(1 * time.Second):
		t.Error("timed out waiting for client channel closure")
	}
}

// recordingController stands in for the MQTT ingestion worker and records which
// modes the hub switched on and off.
type recordingController struct {
	enabled  []string
	disabled []string
}

func (c *recordingController) EnableMode(mode string)  { c.enabled = append(c.enabled, mode) }
func (c *recordingController) DisableMode(mode string) { c.disabled = append(c.disabled, mode) }

func newTestClient() *Client {
	return &Client{send: make(chan []byte, 1), wantsModes: make(map[string]bool)}
}

// Ingestion for an optional mode is switched on at the first client that wants
// it and off again only once the last one is gone — independently per mode.
func TestHub_ModeDemand(t *testing.T) {
	ctl := &recordingController{}
	hub := NewHub(cache.NewMemoryCache())
	hub.SetModeController(ctl)

	a, b := newTestClient(), newTestClient()
	hub.addClient(a)
	hub.addClient(b)

	hub.setClientModePref(a, "metro", true)
	hub.setClientModePref(b, "metro", true)
	hub.setClientModePref(b, "train", true)

	if got := len(ctl.enabled); got != 2 {
		t.Fatalf("expected metro and train enabled once each, got %v", ctl.enabled)
	}
	if ctl.enabled[0] != "metro" || ctl.enabled[1] != "train" {
		t.Errorf("expected [metro train], got %v", ctl.enabled)
	}

	// One of two interested clients leaving must not stop metro ingestion.
	hub.setClientModePref(a, "metro", false)
	if len(ctl.disabled) != 0 {
		t.Errorf("expected no mode disabled while a client still wants metro, got %v", ctl.disabled)
	}

	// Disconnecting the last one releases both of its modes.
	hub.removeClient(b)
	if len(ctl.disabled) != 2 {
		t.Fatalf("expected metro and train disabled on last client leaving, got %v", ctl.disabled)
	}
	if hub.modeDemand["metro"] != 0 || hub.modeDemand["train"] != 0 {
		t.Errorf("expected demand to drop to zero, got %v", hub.modeDemand)
	}
}

// Only bus, metro, train and ferry can be switched on; anything else is ignored
// rather than passed through to the ingestion worker.
func TestHub_IgnoresUnknownModes(t *testing.T) {
	ctl := &recordingController{}
	hub := NewHub(cache.NewMemoryCache())
	hub.SetModeController(ctl)

	client := newTestClient()
	hub.addClient(client)

	hub.setClientModePref(client, "tram", true)
	hub.setClientModePref(client, "funicular", true)
	hub.setClientModePref(client, "../hfp", true)

	if len(ctl.enabled) != 0 {
		t.Errorf("expected no ingestion toggled for unknown modes, got %v", ctl.enabled)
	}
}

// receive reads one broadcast off a client's channel.
func receive(t *testing.T, client *Client) PositionsMessage {
	t.Helper()
	select {
	case data := <-client.send:
		var msg PositionsMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Fatalf("broadcast is not valid JSON: %v\n%s", err, data)
		}
		return msg
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for broadcast")
	}
	return PositionsMessage{}
}

func TestHub_BroadcastsOnlyWantedModes(t *testing.T) {
	ctx := context.Background()
	memCache := cache.NewMemoryCache()
	memCache.SetPosition(ctx, "tram1", []byte(`{"veh":"tram1","mode":"tram"}`))
	memCache.SetPosition(ctx, "bus1", []byte(`{"veh":"bus1","mode":"bus"}`))
	memCache.SetPosition(ctx, "bus2", []byte(`{"veh":"bus2","mode":"bus"}`))
	memCache.SetPosition(ctx, "metro1", []byte(`{"veh":"metro1","mode":"metro"}`))
	// No mode at all, or one that is not optional: never filtered out.
	memCache.SetPosition(ctx, "legacy", []byte(`{"veh":"legacy"}`))

	hub := NewHub(memCache)
	tramsOnly := &Client{send: make(chan []byte, 1), wantsModes: map[string]bool{}}
	buses := &Client{send: make(chan []byte, 1), wantsModes: map[string]bool{}}
	hub.addClient(tramsOnly)
	hub.addClient(buses)
	hub.setClientModePref(buses, "bus", true)

	hub.broadcastSnapshot(ctx)

	got := receive(t, tramsOnly)
	if got.Count != 2 || len(got.Vehicles) != 2 {
		t.Errorf("trams-only client got %d vehicles (count %d), want tram1 and legacy", len(got.Vehicles), got.Count)
	}
	for _, id := range []string{"tram1", "legacy"} {
		if _, ok := got.Vehicles[id]; !ok {
			t.Errorf("trams-only client is missing %s", id)
		}
	}

	got = receive(t, buses)
	if got.Count != 4 {
		t.Errorf("bus client got count %d, want 4 (tram1, bus1, bus2, legacy)", got.Count)
	}
	if _, ok := got.Vehicles["metro1"]; ok {
		t.Error("bus client was sent a metro it did not ask for")
	}
	if _, ok := got.Vehicles["bus2"]; !ok {
		t.Error("bus client is missing bus2")
	}
}

func TestHub_SkipsUnreadableCachedPositions(t *testing.T) {
	ctx := context.Background()
	memCache := cache.NewMemoryCache()
	memCache.SetPosition(ctx, "good", []byte(`{"veh":"good","mode":"tram"}`))
	memCache.SetPosition(ctx, "bad", []byte(`{"veh":`))

	hub := NewHub(memCache)
	client := &Client{send: make(chan []byte, 1), wantsModes: map[string]bool{}}
	hub.addClient(client)
	hub.broadcastSnapshot(ctx)

	got := receive(t, client)
	if got.Count != 1 {
		t.Errorf("count = %d, want 1", got.Count)
	}
	if _, ok := got.Vehicles["good"]; !ok {
		t.Error("a corrupt neighbour cost the good vehicle its place in the message")
	}
}

func TestHub_ClientsWantingTheSameModesShareOnePayload(t *testing.T) {
	ctx := context.Background()
	memCache := cache.NewMemoryCache()
	memCache.SetPosition(ctx, "tram1", []byte(`{"veh":"tram1","mode":"tram"}`))

	hub := NewHub(memCache)
	a := &Client{send: make(chan []byte, 1), wantsModes: map[string]bool{}}
	b := &Client{send: make(chan []byte, 1), wantsModes: map[string]bool{}}
	hub.addClient(a)
	hub.addClient(b)
	hub.broadcastSnapshot(ctx)

	pa, pb := <-a.send, <-b.send
	if &pa[0] != &pb[0] {
		t.Error("two trams-only clients were each given their own copy of the same payload")
	}
}

func TestRecordMode(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{
		{`{"veh":"1","mode":"bus","tlp":{"x":1}}`, "bus"},
		{`{"veh":"1"}`, ""},
		// The sequence inside a string value is always escaped, so it is not
		// mistaken for the field.
		{`{"desi":"\"mode\":\"bus","mode":"tram"}`, "tram"},
	} {
		if got := recordMode([]byte(tc.raw)); got != tc.want {
			t.Errorf("recordMode(%s) = %q, want %q", tc.raw, got, tc.want)
		}
	}
}
