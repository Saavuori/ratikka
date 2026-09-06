package mqtt

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/prometheus/client_golang/prometheus"
	"ratikka/internal/cache"
	"ratikka/internal/replay"
)

const tramTopic = "/hfp/v2/journey/ongoing/vp/tram/#"

// optionalModeTopics are the HFP feeds that are only ingested while at least
// one connected client asks for them. Trams are always on; the rest are opt-in
// because they are either huge (buses are ~80% of the whole feed) or of
// narrower interest (metro, commuter train). They all carry the same VP payload
// on the same topic layout, so one handler serves every mode.
var optionalModeTopics = map[string]string{
	"bus":   "/hfp/v2/journey/ongoing/vp/bus/#",
	"metro": "/hfp/v2/journey/ongoing/vp/metro/#",
	"train": "/hfp/v2/journey/ongoing/vp/train/#",
}

// IsOptionalMode reports whether a mode is one clients can switch on and off.
func IsOptionalMode(mode string) bool {
	_, ok := optionalModeTopics[mode]
	return ok
}

// A metro journey is driven as a pair of coupled units, and each unit publishes
// its own VP stream under its own vehicle number. Both carry the same journey,
// roughly a train-length apart, so ingesting both would put two identical "M1"
// markers on the map that swap places every second. We therefore keep the first
// unit seen for a journey and drop its twin, until the chosen one goes quiet for
// metroUnitTTL (end of journey, or the unit stopped reporting).
const metroUnitTTL = 60 * time.Second

// HSL publishes a tram's VP message four times over. Measured on a five-minute
// capture of the live feed, 97,099 tram messages carried 24,276 distinct
// readings — the same vehicle, the same `tsi`, the same coordinate, delivered
// four times within about a hundred milliseconds. The other three modes are
// delivered once each (bus 1.00x, train 1.00x, metro 1.04x).
//
// Every copy used to be unmarshalled, thinned, re-marshalled and written to
// Redis, so three quarters of all tram ingestion work — and three quarters of
// the write traffic to the position cache — was spent storing a value that was
// already there. Remembering the last reading per vehicle and dropping exact
// repeats costs one small map and removes all of it.
//
// Only an exact repeat is dropped: same timestamp *and* same coordinate. A
// vehicle that genuinely re-reports its position with a fresh timestamp still
// gets through, because the timestamp is what the stale-vehicle sweeper reads
// to decide the vehicle is still alive.
const dedupeTTL = 5 * time.Minute

type lastReading struct {
	ts       int64
	lat      float64
	lng      float64
	nextStop string
	seen     time.Time
}

// HFP topic levels, as indexed after splitting the leading-slash topic on "/":
//
//	/hfp/v2/journey/ongoing/vp/tram/0040/00456/1005T/1/Katajanokan term./17:36/1020450/5/60;24/19/65/90
//	 1   2     3       4     5   6     7     8     9  10       11         12     13    14      15…
//
// The stop the vehicle is heading for is level 13, and it is the one thing the
// payload does not reliably carry. Measured on a five-minute capture of the
// live tram feed (44,432 messages, 47,424 vp readings), every single topic
// named a next stop, while the payload's own `stop` was null on 52.8% of vp
// readings — every message sent between leaving one stop and reaching the next.
// Where the payload did name a stop it agreed with the topic exactly, 22,376
// times out of 22,376, because the payload names the stop the vehicle is
// standing *at*, which until it pulls away is also the one it is heading for.
//
// Reading the next stop off the payload therefore leaves it unknown for half
// the journey, which is why it used to be guessed at from the last stop seen.
const (
	topicMode     = 6
	topicOperator = 7
	topicNextStop = 13
)

// eolStop is what the topic carries in place of a stop ID once the vehicle has
// run out of line to run.
const eolStop = "EOL"

var (
	MessagesReceivedCounter = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "ratikka_mqtt_messages_received_total",
		Help: "Total number of MQTT messages received from HSL broker.",
	}, []string{"route"})

	ParseErrorsCounter = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "ratikka_mqtt_parse_errors_total",
		Help: "Total number of MQTT messages that failed to unmarshal.",
	})
)

func init() {
	prometheus.MustRegister(MessagesReceivedCounter)
	prometheus.MustRegister(ParseErrorsCounter)
}

// HFPPayload represents the raw payload structure from HSL MQTT
type HFPPayload struct {
	VP struct {
		Veh   int         `json:"veh"`
		Desi  string      `json:"desi"`
		Lat   float64     `json:"lat"`
		Long  float64     `json:"long"`
		Hdg   int         `json:"hdg"`
		Spd   float64     `json:"spd"`
		Acc   float64     `json:"acc"`
		Dl    int         `json:"dl"`
		Drst  int         `json:"drst"`
		Route string      `json:"route"`
		Stop  interface{} `json:"stop"`
		Tsi   int64       `json:"tsi"`
		Dir   string      `json:"dir"`
		Oday  string      `json:"oday"`
		Start string      `json:"start"`
		Oper  *int        `json:"oper"`
		Odo   *float64    `json:"odo"`
		Jrn   *int        `json:"jrn"`
		Line  *int        `json:"line"`
		Loc   *string     `json:"loc"`
		Occu  *int        `json:"occu"`
	} `json:"VP"`
}

// VehiclePosition is the thinned down position payload sent to clients and stored in cache
type VehiclePosition struct {
	Veh  string  `json:"veh"`
	Desi string  `json:"desi"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
	Hdg  int     `json:"hdg"`
	Spd  float64 `json:"spd"`
	Acc  float64 `json:"acc"`
	// Dl is seconds behind schedule: positive is late, negative is early. Note
	// this is the negation of HFP's own `dl`, which counts seconds *ahead* of
	// schedule; see normalizeDelay.
	Dl    int    `json:"dl"`
	Drst  int    `json:"drst"`
	Route string `json:"route"`
	// Stop is the stop the vehicle is standing at or inside the stop area of,
	// and is null for the whole run between two stops — it is emphatically not
	// the stop it is heading for. NextStop is.
	Stop *string `json:"stop"`
	// NextStop is the stop the vehicle is heading for, taken from the HFP topic
	// rather than the payload so it is answered on every single message. Null
	// only when the feed itself does not name one, including at end of line,
	// where Eol is set instead.
	NextStop *string `json:"nextStop"`
	// Eol reports that the vehicle has reached the end of its line and has no
	// next stop left to run to.
	Eol    bool     `json:"eol,omitempty"`
	Ts     int64    `json:"ts"`
	TripId string   `json:"tripId"`
	Mode   string   `json:"mode"`
	Odo    *float64 `json:"odo,omitempty"`
	Loc    *string  `json:"loc,omitempty"`
	Oper   *int     `json:"oper,omitempty"`
	Jrn    *int     `json:"jrn,omitempty"`
	Occu   *int     `json:"occu,omitempty"`
	Dir    string   `json:"dir,omitempty"`
	Oday   string   `json:"oday,omitempty"`
	Start  string   `json:"start,omitempty"`
}

type IngestionWorker struct {
	client mqtt.Client
	cache  cache.Cache
	broker string

	// archive keeps a rolling history of the readings that reach the cache, so
	// the map can be wound back through it. Nil — the default, and what an
	// instance with no writable volume gets — records nothing; every method on
	// it tolerates that, so there is no branch here.
	archive *replay.Archive

	// enabledModes tracks which optional feeds (bus, metro, train) are
	// currently subscribed. Guarded by mu because EnableMode/DisableMode are
	// called from the WebSocket hub goroutine while OnConnect (reconnect) reads
	// it from the MQTT client goroutine.
	mu           sync.Mutex
	enabledModes map[string]bool

	// metroUnits maps a metro journey to the unit whose positions we keep; see
	// metroUnitTTL. Guarded by metroMu, held only by the MQTT receive goroutine.
	metroMu    sync.Mutex
	metroUnits map[string]metroUnit

	// lastReadings holds the newest reading seen per vehicle, so the duplicate
	// copies HSL publishes are dropped before they cost a cache write; see
	// dedupeTTL. Guarded by dedupeMu because paho dispatches message handlers
	// concurrently.
	dedupeMu     sync.Mutex
	lastReadings map[string]lastReading
}

type metroUnit struct {
	veh  int
	seen time.Time
}

// SetArchive wires the replay archive that records readings as they are
// ingested. Call once before Start.
func (w *IngestionWorker) SetArchive(a *replay.Archive) { w.archive = a }

func NewIngestionWorker(broker string, cache cache.Cache) *IngestionWorker {
	return &IngestionWorker{
		broker:       broker,
		cache:        cache,
		enabledModes: make(map[string]bool),
		metroUnits:   make(map[string]metroUnit),
		lastReadings: make(map[string]lastReading),
	}
}

func (w *IngestionWorker) Start(ctx context.Context) error {
	opts := mqtt.NewClientOptions()
	opts.AddBroker(w.broker)
	opts.SetClientID(fmt.Sprintf("ratikka-backend-%d", time.Now().UnixNano()))
	opts.SetCleanSession(true)
	opts.SetAutoReconnect(true)
	opts.SetConnectTimeout(10 * time.Second)

	// KeepAlive and PingTimeout
	opts.SetKeepAlive(30 * time.Second)
	opts.SetPingTimeout(10 * time.Second)

	// Callback when connection is established (or re-established). Trams are
	// always subscribed; the optional modes are only (re)subscribed if a client
	// currently wants them, so the subscription state survives MQTT reconnects.
	opts.OnConnect = func(client mqtt.Client) {
		log.Println("MQTT connected to broker:", w.broker)
		if token := client.Subscribe(tramTopic, 0, w.handleMessage); token.Wait() && token.Error() != nil {
			log.Printf("Failed to subscribe to tram topic: %v\n", token.Error())
		} else {
			log.Println("Subscribed to tram topic")
		}

		w.mu.Lock()
		wanted := make([]string, 0, len(w.enabledModes))
		for mode, on := range w.enabledModes {
			if on {
				wanted = append(wanted, mode)
			}
		}
		w.mu.Unlock()
		for _, mode := range wanted {
			w.subscribeMode(client, mode)
		}
	}

	opts.OnConnectionLost = func(client mqtt.Client, err error) {
		log.Printf("MQTT connection lost: %v\n", err)
	}

	w.client = mqtt.NewClient(opts)

	if token := w.client.Connect(); token.Wait() && token.Error() != nil {
		return fmt.Errorf("failed to connect to MQTT broker: %w", token.Error())
	}

	return nil
}

func (w *IngestionWorker) IsConnected() bool {
	return w.client != nil && w.client.IsConnected()
}

// EnableMode starts ingesting positions for an optional mode ("bus", "metro"
// or "train"). Called when the first client opts in to it. Idempotent, ignores
// unknown modes, and safe to call from another goroutine.
func (w *IngestionWorker) EnableMode(mode string) {
	if !IsOptionalMode(mode) {
		return
	}

	w.mu.Lock()
	if w.enabledModes[mode] {
		w.mu.Unlock()
		return
	}
	w.enabledModes[mode] = true
	w.mu.Unlock()

	log.Printf("%s ingestion enabled (a client requested it)\n", mode)
	if w.client != nil && w.client.IsConnected() {
		w.subscribeMode(w.client, mode)
	}
}

// DisableMode stops ingesting positions for an optional mode. Called when the
// last client that wanted it disconnects or toggles it off. Stale entries
// already in the cache expire via the normal 60s cleanup. Idempotent.
func (w *IngestionWorker) DisableMode(mode string) {
	if !IsOptionalMode(mode) {
		return
	}

	w.mu.Lock()
	if !w.enabledModes[mode] {
		w.mu.Unlock()
		return
	}
	w.enabledModes[mode] = false
	w.mu.Unlock()

	log.Printf("%s ingestion disabled (no clients want it)\n", mode)
	if w.client != nil && w.client.IsConnected() {
		if token := w.client.Unsubscribe(optionalModeTopics[mode]); token.Wait() && token.Error() != nil {
			log.Printf("Failed to unsubscribe from %s topic: %v\n", mode, token.Error())
		}
	}
}

func (w *IngestionWorker) subscribeMode(client mqtt.Client, mode string) {
	topic, ok := optionalModeTopics[mode]
	if !ok {
		return
	}
	if token := client.Subscribe(topic, 0, w.handleMessage); token.Wait() && token.Error() != nil {
		log.Printf("Failed to subscribe to %s topic: %v\n", mode, token.Error())
	} else {
		log.Printf("Subscribed to %s topic\n", mode)
	}
}

func (w *IngestionWorker) Stop() {
	if w.client != nil && w.client.IsConnected() {
		w.client.Disconnect(250)
	}
}

func (w *IngestionWorker) handleMessage(client mqtt.Client, msg mqtt.Message) {
	var payload HFPPayload
	if err := json.Unmarshal(msg.Payload(), &payload); err != nil {
		ParseErrorsCounter.Inc()
		// Log but don't crash on parsing errors (graceful parsing degradation)
		log.Printf("Error unmarshaling MQTT payload: %v (raw: %s)\n", err, string(msg.Payload()))
		return
	}

	vp := payload.VP
	// Filter out zero / invalid coordinate updates
	if vp.Veh == 0 || vp.Lat == 0 || vp.Long == 0 {
		return
	}

	var stopStr *string
	if vp.Stop != nil {
		switch v := vp.Stop.(type) {
		case string:
			if v != "" {
				s := v
				if len(s) < 4 || s[:4] != "HSL:" {
					s = "HSL:" + s
				}
				stopStr = &s
			}
		case float64:
			s := fmt.Sprintf("HSL:%d", int64(v))
			stopStr = &s
		}
	}

	tripId := ""
	if vp.Route != "" && vp.Oday != "" && vp.Dir != "" && vp.Start != "" {
		tripId = constructGTFSTripID(vp.Route, vp.Oday, vp.Dir, vp.Start)
	}

	// A missing/zero HFP timestamp would make the stale-vehicle sweeper purge
	// this live vehicle immediately; fall back to ingestion time.
	if vp.Tsi == 0 {
		vp.Tsi = time.Now().Unix()
	}

	routeLabel := vp.Route
	if routeLabel == "" {
		routeLabel = "unknown"
	}
	MessagesReceivedCounter.WithLabelValues(routeLabel).Inc()

	parts := strings.Split(msg.Topic(), "/")
	mode := "tram"
	if len(parts) > topicMode {
		mode = parts[topicMode]
	}

	operator := "unknown"
	if len(parts) > topicOperator {
		operator = parts[topicOperator]
	}
	vehicleID := fmt.Sprintf("%s-%d", operator, vp.Veh)

	nextStop, eol := parseNextStop(parts)

	// Coupled metro units publish the same journey twice; keep only one of them.
	if mode == "metro" && !w.acceptMetroUnit(vp.Route, vp.Dir, vp.Oday, vp.Start, vp.Veh) {
		return
	}

	// HSL delivers each tram message four times; drop the copies. See dedupeTTL.
	if !w.acceptReading(vehicleID, vp.Tsi, vp.Lat, vp.Long, nextStopKey(nextStop, eol)) {
		return
	}

	thinned := VehiclePosition{
		Veh:      vehicleID,
		Desi:     vp.Desi,
		Lat:      vp.Lat,
		Lng:      vp.Long, // Translate "long" in HFP to "lng" in internal api
		Hdg:      vp.Hdg,
		Spd:      vp.Spd,
		Acc:      vp.Acc,
		Dl:       normalizeDelay(vp.Dl),
		Drst:     vp.Drst,
		Route:    vp.Route,
		Stop:     stopStr,
		NextStop: nextStop,
		Eol:      eol,
		Ts:       vp.Tsi,
		TripId:   tripId,
		Mode:     mode,
		Odo:      vp.Odo,
		Loc:      vp.Loc,
		Oper:     vp.Oper,
		Jrn:      vp.Jrn,
		Occu:     vp.Occu,
		Dir:      vp.Dir,
		Oday:     vp.Oday,
		Start:    vp.Start,
	}

	thinnedJSON, err := json.Marshal(thinned)
	if err != nil {
		log.Printf("Error marshaling thinned position for vehicle %s: %v\n", vehicleID, err)
		return
	}

	// Save to cache (use a background context or timeout context to prevent blocking MQTT receiver)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := w.cache.SetPosition(ctx, vehicleID, thinnedJSON); err != nil {
		log.Printf("Error caching vehicle %s position: %v\n", vehicleID, err)
	}

	w.archiveReading(thinned, nextStop, eol, stopStr != nil)
}

// archiveReading files the reading in the replay archive. It is handed the same
// values the cache was given, after dedupe and after the metro's coupled units
// have been paired down, so the history holds exactly what the live map showed
// rather than the raw feed.
//
// Errors are logged and swallowed: a full disk or a bad chunk must cost the
// history, never the live map.
func (w *IngestionWorker) archiveReading(pos VehiclePosition, nextStop *string, eol, atStop bool) {
	if !w.archive.Records(pos.Mode) {
		return
	}

	next := ""
	if nextStop != nil {
		next = *nextStop
	}

	if err := w.archive.Record(replay.Position{
		Veh: pos.Veh, Desi: pos.Desi, Route: pos.Route, Dir: pos.Dir,
		Oday: pos.Oday, Start: pos.Start, TripID: pos.TripId, Mode: pos.Mode,
		Lat: pos.Lat, Lng: pos.Lng, Hdg: pos.Hdg, Spd: pos.Spd, Acc: pos.Acc,
		Dl: pos.Dl, Drst: pos.Drst, AtStop: atStop, NextStop: next, EOL: eol,
		Ts: pos.Ts, Odo: pos.Odo, Oper: pos.Oper, Jrn: pos.Jrn, Occu: pos.Occu,
	}); err != nil {
		log.Printf("Error recording vehicle %s to the replay archive: %v\n", pos.Veh, err)
	}
}

// acceptReading reports whether this message says anything the cache does not
// already hold: a reading is accepted unless the same vehicle's previous one
// carried an identical timestamp and coordinate.
//
// The map is swept rather than left to grow, on the same trigger as
// metroUnits: the fleet turns over as journeys start and end, and a vehicle
// that has not been heard from in dedupeTTL is long gone from the position
// cache too.
// The next stop is part of what makes a reading distinct, not just the
// coordinate: a vehicle standing still at a terminus reports the same position
// second after second, and the message that finally names its onward stop must
// not be mistaken for one of the copies.
func (w *IngestionWorker) acceptReading(vehicleID string, ts int64, lat, lng float64, nextStop string) bool {
	now := time.Now()

	w.dedupeMu.Lock()
	defer w.dedupeMu.Unlock()

	if prev, ok := w.lastReadings[vehicleID]; ok && prev.ts == ts && prev.lat == lat && prev.lng == lng &&
		prev.nextStop == nextStop {
		return false
	}
	w.lastReadings[vehicleID] = lastReading{ts: ts, lat: lat, lng: lng, nextStop: nextStop, seen: now}

	if len(w.lastReadings) > 4096 {
		for k, r := range w.lastReadings {
			if now.Sub(r.seen) > dedupeTTL {
				delete(w.lastReadings, k)
			}
		}
	}
	return true
}

// acceptMetroUnit reports whether this metro message comes from the unit we
// track for its journey. The first unit seen wins and keeps winning while it
// keeps reporting; once it has been quiet for metroUnitTTL (the journey ended,
// or that unit stopped publishing) the next message to arrive takes over.
func (w *IngestionWorker) acceptMetroUnit(route, dir, oday, start string, veh int) bool {
	// Without a journey identity there is nothing to pair the units by, so the
	// message is passed through rather than dropped.
	if route == "" || dir == "" || start == "" {
		return true
	}
	key := route + "/" + dir + "/" + oday + "/" + start
	now := time.Now()

	w.metroMu.Lock()
	defer w.metroMu.Unlock()

	if cur, ok := w.metroUnits[key]; ok && now.Sub(cur.seen) <= metroUnitTTL {
		if cur.veh != veh {
			return false
		}
	}
	w.metroUnits[key] = metroUnit{veh: veh, seen: now}

	// Journeys retire constantly, so sweep expired entries rather than letting
	// the map grow for the life of the process.
	if len(w.metroUnits) > 512 {
		for k, u := range w.metroUnits {
			if now.Sub(u.seen) > metroUnitTTL {
				delete(w.metroUnits, k)
			}
		}
	}
	return true
}

// parseNextStop reads the stop the vehicle is heading for off the topic levels,
// returning it as a prefixed GTFS ID together with whether the vehicle has
// reached the end of its line.
//
// A topic that names no stop at all — an empty level, or the literal "null" the
// feed uses for a vehicle whose journey has no onward stop on file — yields
// neither, so the client is told nothing rather than something invented.
func parseNextStop(parts []string) (*string, bool) {
	if len(parts) <= topicNextStop {
		return nil, false
	}
	raw := strings.TrimSpace(parts[topicNextStop])
	if raw == eolStop {
		return nil, true
	}
	if raw == "" || raw == "null" {
		return nil, false
	}
	id := raw
	if !strings.HasPrefix(id, "HSL:") {
		id = "HSL:" + id
	}
	return &id, false
}

// nextStopKey renders a parsed next stop as the single string the dedupe map
// compares, so "at the end of the line" is distinct from "not stated".
func nextStopKey(nextStop *string, eol bool) string {
	if eol {
		return eolStop
	}
	if nextStop == nil {
		return ""
	}
	return *nextStop
}

// normalizeDelay turns HFP's `dl` into the sign convention the rest of the
// application uses.
//
// HFP counts seconds *ahead* of schedule, so a late vehicle reports a negative
// `dl` — the opposite of GTFS-RT, and the opposite of the `delay` fields the
// timetable API hands us for the very same journeys. Measured against the
// scheduled times HFP itself publishes on its own stop events (`ttarr` against
// the event's `tst`), 108 of the 109 samples in a five-minute capture that were
// more than 90 seconds off schedule agreed: positive `dl` meant early, negative
// meant late.
//
// Negating it here means one convention holds everywhere downstream — positive
// is late — rather than each reader having to remember which feed a number came
// from.
func normalizeDelay(dl int) int {
	return -dl
}

func constructGTFSTripID(route, oday, dir, start string) string {
	// Strip HSL: prefix from route if present
	r := strings.TrimSpace(route)
	if len(r) > 4 && r[:4] == "HSL:" {
		r = r[4:]
	}
	// Strip - from oday (e.g. 2026-06-15 -> 20260615)
	o := strings.ReplaceAll(oday, "-", "")
	// Strip : from start (e.g. 09:15 -> 0915)
	s := strings.ReplaceAll(start, ":", "")

	// Get weekday prefix
	var weekdayStr string
	if t, err := time.Parse("2006-01-02", oday); err == nil {
		switch t.Weekday() {
		case time.Sunday:
			weekdayStr = "Su"
		case time.Monday:
			weekdayStr = "Mo"
		case time.Tuesday:
			weekdayStr = "Tu"
		case time.Wednesday:
			weekdayStr = "We"
		case time.Thursday:
			weekdayStr = "Th"
		case time.Friday:
			weekdayStr = "Fr"
		case time.Saturday:
			weekdayStr = "Sa"
		}
	} else {
		weekdayStr = "Mo" // Default fallback
	}

	return fmt.Sprintf("HSL:%s_%s_%s_%s_%s", r, o, weekdayStr, dir, s)
}
