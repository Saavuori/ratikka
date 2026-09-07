package mqtt

import (
	"encoding/json"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/prometheus/client_golang/prometheus"
)

// Traffic light priority, as the vehicles themselves report it.
//
// A Helsinki tram does not simply wait for a green: as it comes up on a
// signalised junction its onboard computer *asks* the junction for one, and
// the junction answers. Both halves of that exchange are on the same MQTT feed
// the positions come from, as their own HFP event types:
//
//	tlr — the vehicle is requesting priority at junction `sid`
//	tla — the junction has answered that request (ACK or NAK)
//
// Which makes this the one thing about a stopped tram that had been guesswork.
// The junction locations from Helsinki open data (see api/traffic_lights.go)
// only say where a tram *could* be held at a light; `tlr`/`tla` say that this
// tram, at this junction, asked for a green and was given or refused one.
//
// The events arrive on their own topics, out of band from the vehicle's
// position stream, and they are momentary — a request and its answer can both
// land inside a single second. So rather than forwarding them as their own
// message type, the newest exchange per vehicle is held here and folded into
// that vehicle's next position update, which for a tram is never more than a
// second away. Clients get one object to render and no second stream to join.

// tlpTopicsFor returns the priority-request topics for a transport mode, or
// nil for the modes that have none. Only trams and buses run the equipment:
// HFP publishes no events at all for metro, and a commuter train does not ask
// a street junction for anything.
func tlpTopicsFor(mode string) []string {
	switch mode {
	case "tram", "bus":
		return []string{
			"/hfp/v2/journey/ongoing/tlr/" + mode + "/#",
			"/hfp/v2/journey/ongoing/tla/" + mode + "/#",
		}
	default:
		return nil
	}
}

// tlpTTL is how long an exchange stays attached to its vehicle. A request is
// sent on the approach to a junction and repeated until the vehicle is
// through, so this only has to outlive the gaps between attempts and the
// crossing itself; after it the vehicle is somewhere down the street and the
// junction it asked is no longer news.
const tlpTTL = 25 * time.Second

// The `sid` (junction) level of a tlr/tla topic. It is the last level of the
// documented topic layout, and it is the only place a `tla` names its
// junction — the answer payload carries the request ID but not the junction
// it came from.
//
//	/hfp/v2/journey/ongoing/tla/tram/0040/00407/1010B/2/Kolmikulma/22:00/1140441/4/60;24/19/91/13/75
//	 1   2     3       4     5    6    7     8     9  10    11      12     13    14   15  16 17 18 19
const topicJunction = 19

// Statuses of a priority exchange, as sent to clients.
const (
	// TLPRequesting: the vehicle has asked and has not been answered yet.
	TLPRequesting = "requesting"
	// TLPGranted: the junction acknowledged the request (`tla` decision ACK).
	TLPGranted = "granted"
	// TLPDenied: the junction refused it (`tla` decision NAK).
	TLPDenied = "denied"
	// TLPNoRequest: the vehicle reached a junction it is equipped to ask and
	// deliberately did not, carrying the reason why in Reason.
	TLPNoRequest = "norequest"
)

// SignalPriority is the newest traffic light priority exchange for one
// vehicle, as attached to its position.
type SignalPriority struct {
	// Status is one of the TLP* constants above.
	Status string `json:"status"`
	// Junction is the signal junction ID (`sid`). It matches the `id` of the
	// traffic-light features served by GET /api/v1/traffic-lights, which come
	// from Helsinki's own junction numbering.
	Junction *int `json:"junction,omitempty"`
	// SignalGroup is the group of lights within the junction the request was
	// aimed at, and SignalGroupNbr the specific light in that group.
	SignalGroup    *int `json:"signalGroup,omitempty"`
	SignalGroupNbr *int `json:"signalGroupNbr,omitempty"`
	// RequestID ties a request to the answer that came back for it.
	RequestID *int `json:"requestId,omitempty"`
	// RequestType is what the vehicle asked for: NORMAL, DOOR_CLOSE,
	// DOOR_OPEN or ADVANCE.
	RequestType string `json:"requestType,omitempty"`
	// Level is the priority asked for: "normal", "high", or "norequest" when
	// the vehicle declined to ask.
	Level string `json:"level,omitempty"`
	// Reason is why no request was sent: GLOBAL, AHEAD, LINE or PRIOEXEP.
	Reason string `json:"reason,omitempty"`
	// Attempts is the attempt sequence number of the current request.
	Attempts int `json:"attempts,omitempty"`
	// Protocol is the radio protocol used, MQTT or KAR-MQTT.
	Protocol string `json:"protocol,omitempty"`
	// Ts is the vehicle's own timestamp for the newest event in the exchange.
	Ts int64 `json:"ts"`
}

// tlpEvent is the subset of a TLR/TLA payload we read. Both event types share
// the ordinary position fields; only the tlp-* ones differ between them.
type tlpEvent struct {
	Veh            int    `json:"veh"`
	Tsi            int64  `json:"tsi"`
	Sid            *int   `json:"sid"`
	SignalGroupID  *int   `json:"signal-groupid"`
	SignalGroupNbr *int   `json:"tlp-signalgroupnbr"`
	RequestID      *int   `json:"tlp-requestid"`
	RequestType    string `json:"tlp-requesttype"`
	PriorityLevel  string `json:"tlp-prioritylevel"`
	Reason         string `json:"tlp-reason"`
	AttSeq         int    `json:"tlp-att-seq"`
	Decision       string `json:"tlp-decision"`
	Protocol       string `json:"tlp-protocol"`
}

type tlpPayload struct {
	TLR *tlpEvent `json:"TLR"`
	TLA *tlpEvent `json:"TLA"`
}

type tlpRecord struct {
	state SignalPriority
	seen  time.Time
}

var TLPEventsCounter = prometheus.NewCounterVec(prometheus.CounterOpts{
	Name: "ratikka_mqtt_tlp_events_total",
	Help: "Traffic light priority events ingested, by mode and resulting status.",
}, []string{"mode", "status"})

func init() {
	prometheus.MustRegister(TLPEventsCounter)
}

// tlpStore holds the newest exchange per vehicle. It is written from the MQTT
// receive goroutines (paho dispatches handlers concurrently) and read from the
// same goroutines while thinning positions, so every access takes the mutex.
type tlpStore struct {
	mu      sync.Mutex
	records map[string]tlpRecord
}

func newTLPStore() *tlpStore {
	return &tlpStore{records: make(map[string]tlpRecord)}
}

// put records an exchange, superseding whatever that vehicle had before.
func (s *tlpStore) put(vehicleID string, state SignalPriority, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records[vehicleID] = tlpRecord{state: state, seen: now}

	// The fleet turns over as journeys start and end, so sweep rather than let
	// the map grow for the life of the process. Same shape as the position
	// dedupe map next door.
	if len(s.records) > 2048 {
		for k, r := range s.records {
			if now.Sub(r.seen) > tlpTTL {
				delete(s.records, k)
			}
		}
	}
}

// get returns the vehicle's current exchange, or nil once it has aged out.
func (s *tlpStore) get(vehicleID string, now time.Time) *SignalPriority {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.records[vehicleID]
	if !ok {
		return nil
	}
	if now.Sub(r.seen) > tlpTTL {
		delete(s.records, vehicleID)
		return nil
	}
	state := r.state
	return &state
}

// answer folds a `tla` decision into the request it belongs to, keyed by
// request ID. The answer payload carries neither the junction nor what was
// asked for, so where it matches the request we already hold, that request is
// kept and only its outcome changes; where it does not (the request was missed,
// or has aged out) the answer stands on its own with whatever the topic said.
func (s *tlpStore) answer(vehicleID string, ev *tlpEvent, junction *int, now time.Time) SignalPriority {
	s.mu.Lock()
	defer s.mu.Unlock()

	state := SignalPriority{
		Junction:  junction,
		RequestID: ev.RequestID,
	}
	if r, ok := s.records[vehicleID]; ok && now.Sub(r.seen) <= tlpTTL &&
		samePtrInt(r.state.RequestID, ev.RequestID) {
		state = r.state
		if junction != nil {
			state.Junction = junction
		}
	}
	state.Status = decisionStatus(ev.Decision)
	state.Ts = ev.Tsi

	s.records[vehicleID] = tlpRecord{state: state, seen: now}
	return state
}

func samePtrInt(a, b *int) bool {
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// decisionStatus maps a `tla` decision onto a status. Anything other than a
// plain NAK is read as granted: ACK is the only value seen in the wild, and an
// unrecognised answer is still an answer.
func decisionStatus(decision string) string {
	if strings.EqualFold(decision, "NAK") {
		return TLPDenied
	}
	return TLPGranted
}

// requestStatus reads a `tlr`. A vehicle publishes one of these even when it
// decides *not* to ask — priority level "norequest", with the reason it held
// back — and that is worth showing as its own state rather than as a request.
func requestStatus(ev *tlpEvent) string {
	if strings.EqualFold(ev.PriorityLevel, "norequest") || ev.Reason != "" {
		return TLPNoRequest
	}
	return TLPRequesting
}

// parseTLPJunction reads the junction ID off a tlr/tla topic. Returns nil when
// the topic is shorter than the documented layout or the level is not a
// number, which is how a topic with no junction on it reads.
func parseTLPJunction(parts []string) *int {
	if len(parts) <= topicJunction {
		return nil
	}
	sid, err := strconv.Atoi(parts[topicJunction])
	if err != nil {
		return nil
	}
	return &sid
}

// handleTLPMessage ingests one tlr or tla message.
func (w *IngestionWorker) handleTLPMessage(_ mqtt.Client, msg mqtt.Message) {
	var payload tlpPayload
	if err := json.Unmarshal(msg.Payload(), &payload); err != nil {
		ParseErrorsCounter.Inc()
		log.Printf("Error unmarshaling MQTT TLP payload: %v (raw: %s)\n", err, string(msg.Payload()))
		return
	}

	parts := strings.Split(msg.Topic(), "/")
	mode := "tram"
	if len(parts) > topicMode {
		mode = parts[topicMode]
	}
	operator := "unknown"
	if len(parts) > topicOperator {
		operator = parts[topicOperator]
	}

	junction := parseTLPJunction(parts)
	now := time.Now()

	switch {
	case payload.TLR != nil:
		ev := payload.TLR
		if ev.Veh == 0 {
			return
		}
		if ev.Sid != nil {
			junction = ev.Sid
		}
		state := SignalPriority{
			Status:         requestStatus(ev),
			Junction:       junction,
			SignalGroup:    ev.SignalGroupID,
			SignalGroupNbr: ev.SignalGroupNbr,
			RequestID:      ev.RequestID,
			RequestType:    ev.RequestType,
			Level:          ev.PriorityLevel,
			Reason:         ev.Reason,
			Attempts:       ev.AttSeq,
			Protocol:       ev.Protocol,
			Ts:             ev.Tsi,
		}
		w.tlp.put(vehicleKey(operator, ev.Veh), state, now)
		TLPEventsCounter.WithLabelValues(mode, state.Status).Inc()

	case payload.TLA != nil:
		ev := payload.TLA
		if ev.Veh == 0 {
			return
		}
		state := w.tlp.answer(vehicleKey(operator, ev.Veh), ev, junction, now)
		TLPEventsCounter.WithLabelValues(mode, state.Status).Inc()
	}
}

// subscribeTLP subscribes to a mode's priority topics, where it has any.
func (w *IngestionWorker) subscribeTLP(client mqtt.Client, mode string) {
	for _, topic := range tlpTopicsFor(mode) {
		if token := client.Subscribe(topic, 0, w.handleTLPMessage); token.Wait() && token.Error() != nil {
			log.Printf("Failed to subscribe to %s priority topic %s: %v\n", mode, topic, token.Error())
		}
	}
}

// unsubscribeTLP drops a mode's priority topics again.
func (w *IngestionWorker) unsubscribeTLP(client mqtt.Client, mode string) {
	topics := tlpTopicsFor(mode)
	if len(topics) == 0 {
		return
	}
	if token := client.Unsubscribe(topics...); token.Wait() && token.Error() != nil {
		log.Printf("Failed to unsubscribe from %s priority topics: %v\n", mode, token.Error())
	}
}
