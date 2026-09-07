package mqtt

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"ratikka/internal/cache"
)

// The payloads below are verbatim captures from the live HSL feed (tram 407 on
// line 10B asking junction 75 for a green, and the answer that came back), so
// the field names and shapes here are the ones actually published rather than
// the ones the documentation describes — the two disagree about which event
// carries `tlp-decision`.
const tlrTopic = "/hfp/v2/journey/ongoing/tlr/tram/0040/00407/1010B/2/Kolmikulma/22:00/1140441/4/60;24/19/91/13/75"

const tlrPayload = `{"TLR":{"desi":"10B","dir":"2","oper":40,"veh":407,"tst":"2026-09-06T19:08:38.251Z",` +
	`"tsi":1788721718,"spd":4.89,"hdg":132,"lat":60.191122,"long":24.913142,"acc":-0.51,"dl":-35,` +
	`"odo":2531,"drst":0,"oday":"2026-09-06","jrn":6799,"line":1141,"start":"22:00","loc":"GPS",` +
	`"stop":null,"route":"1010B","occu":0,"sid":75,"signal-groupid":673,"tlp-signalgroupnbr":14,` +
	`"tlp-requestid":219,"tlp-requesttype":"NORMAL","tlp-prioritylevel":"normal",` +
	`"tlp-line-configid":null,"tlp-point-configid":null,"tlp-frequency":461200,` +
	`"tlp-protocol":"KAR-MQTT","tlp-att-seq":1}}`

const tlaTopic = "/hfp/v2/journey/ongoing/tla/tram/0040/00407/1010B/2/Kolmikulma/22:00/1140441/4/60;24/19/91/13/75"

const tlaPayload = `{"TLA":{"desi":"10B","dir":"2","oper":40,"veh":407,"tst":"2026-09-06T19:08:39.101Z",` +
	`"tsi":1788721719,"spd":4.89,"hdg":132,"lat":60.191122,"long":24.913142,"acc":-0.51,"dl":-35,` +
	`"odo":2531,"drst":0,"oday":"2026-09-06","jrn":6799,"line":1141,"start":"22:00","loc":"GPS",` +
	`"stop":null,"route":"1010B","occu":0,"tlp-requestid":219,"tlp-decision":"ACK"}}`

func tlpWorker() *IngestionWorker {
	return NewIngestionWorker("tls://mock:8883", cache.NewMemoryCache())
}

func TestHandleTLPMessage_Request(t *testing.T) {
	w := tlpWorker()
	w.handleTLPMessage(nil, &mockMessage{payload: []byte(tlrPayload), topic: tlrTopic})

	state := w.tlp.get("0040-407", time.Now())
	if state == nil {
		t.Fatal("expected a priority state for the requesting tram")
	}
	if state.Status != TLPRequesting {
		t.Errorf("status = %q, want %q", state.Status, TLPRequesting)
	}
	if state.Junction == nil || *state.Junction != 75 {
		t.Errorf("junction = %v, want 75", state.Junction)
	}
	if state.SignalGroup == nil || *state.SignalGroup != 673 {
		t.Errorf("signalGroup = %v, want 673", state.SignalGroup)
	}
	if state.SignalGroupNbr == nil || *state.SignalGroupNbr != 14 {
		t.Errorf("signalGroupNbr = %v, want 14", state.SignalGroupNbr)
	}
	if state.RequestType != "NORMAL" || state.Level != "normal" {
		t.Errorf("requestType/level = %q/%q, want NORMAL/normal", state.RequestType, state.Level)
	}
	if state.Attempts != 1 || state.Protocol != "KAR-MQTT" {
		t.Errorf("attempts/protocol = %d/%q, want 1/KAR-MQTT", state.Attempts, state.Protocol)
	}
	if state.Ts != 1788721718 {
		t.Errorf("ts = %d, want 1788721718", state.Ts)
	}
}

// The answer names neither the junction nor what was asked for, so it has to
// inherit both from the request it matches.
func TestHandleTLPMessage_AnswerKeepsRequestContext(t *testing.T) {
	w := tlpWorker()
	w.handleTLPMessage(nil, &mockMessage{payload: []byte(tlrPayload), topic: tlrTopic})
	w.handleTLPMessage(nil, &mockMessage{payload: []byte(tlaPayload), topic: tlaTopic})

	state := w.tlp.get("0040-407", time.Now())
	if state == nil {
		t.Fatal("expected a priority state after the answer")
	}
	if state.Status != TLPGranted {
		t.Errorf("status = %q, want %q", state.Status, TLPGranted)
	}
	if state.Junction == nil || *state.Junction != 75 {
		t.Errorf("junction = %v, want 75", state.Junction)
	}
	if state.RequestType != "NORMAL" {
		t.Errorf("requestType = %q, want NORMAL carried over from the request", state.RequestType)
	}
	if state.Ts != 1788721719 {
		t.Errorf("ts = %d, want the answer's own timestamp", state.Ts)
	}
}

// An answer arriving without its request still says something — that this
// vehicle was granted or refused a green at the junction on the topic.
func TestHandleTLPMessage_AnswerAlone(t *testing.T) {
	w := tlpWorker()
	nak := `{"TLA":{"veh":407,"tsi":1788721719,"tlp-requestid":219,"tlp-decision":"NAK"}}`
	w.handleTLPMessage(nil, &mockMessage{payload: []byte(nak), topic: tlaTopic})

	state := w.tlp.get("0040-407", time.Now())
	if state == nil {
		t.Fatal("expected a priority state from the lone answer")
	}
	if state.Status != TLPDenied {
		t.Errorf("status = %q, want %q", state.Status, TLPDenied)
	}
	if state.Junction == nil || *state.Junction != 75 {
		t.Errorf("junction = %v, want 75 read off the topic", state.Junction)
	}
}

// A stale request must not be answered by an unrelated later decision: the
// request IDs have to match, or the answer stands alone.
func TestHandleTLPMessage_AnswerIgnoresMismatchedRequestID(t *testing.T) {
	w := tlpWorker()
	w.handleTLPMessage(nil, &mockMessage{payload: []byte(tlrPayload), topic: tlrTopic})
	other := `{"TLA":{"veh":407,"tsi":1788721719,"tlp-requestid":7,"tlp-decision":"ACK"}}`
	w.handleTLPMessage(nil, &mockMessage{payload: []byte(other), topic: tlaTopic})

	state := w.tlp.get("0040-407", time.Now())
	if state == nil {
		t.Fatal("expected a priority state")
	}
	if state.RequestType != "" {
		t.Errorf("requestType = %q, want empty — this answer belongs to another request", state.RequestType)
	}
	if state.RequestID == nil || *state.RequestID != 7 {
		t.Errorf("requestId = %v, want 7", state.RequestID)
	}
}

// "norequest" is a vehicle at a junction it could ask, deciding not to. That is
// a different thing from asking, and is reported as such.
func TestHandleTLPMessage_NoRequest(t *testing.T) {
	w := tlpWorker()
	payload := `{"TLR":{"veh":407,"tsi":1788721718,"sid":75,"tlp-requestid":3,` +
		`"tlp-prioritylevel":"norequest","tlp-reason":"PRIOEXEP","tlp-att-seq":1}}`
	w.handleTLPMessage(nil, &mockMessage{payload: []byte(payload), topic: tlrTopic})

	state := w.tlp.get("0040-407", time.Now())
	if state == nil {
		t.Fatal("expected a priority state")
	}
	if state.Status != TLPNoRequest {
		t.Errorf("status = %q, want %q", state.Status, TLPNoRequest)
	}
	if state.Reason != "PRIOEXEP" {
		t.Errorf("reason = %q, want PRIOEXEP", state.Reason)
	}
}

// The exchange is momentary; a tram three junctions further on should not still
// be shown asking this one.
func TestTLPStore_Expires(t *testing.T) {
	s := newTLPStore()
	now := time.Now()
	s.put("0040-407", SignalPriority{Status: TLPRequesting}, now)

	if s.get("0040-407", now.Add(tlpTTL-time.Second)) == nil {
		t.Error("state expired too early")
	}
	if s.get("0040-407", now.Add(tlpTTL+time.Second)) != nil {
		t.Error("state outlived its TTL")
	}
}

// The whole point of holding the exchange: it has to come out attached to the
// vehicle's next position, because that is the only stream clients read.
func TestHandleMessage_AttachesPriorityToPosition(t *testing.T) {
	memCache := cache.NewMemoryCache()
	w := NewIngestionWorker("tls://mock:8883", memCache)

	w.handleTLPMessage(nil, &mockMessage{payload: []byte(tlrPayload), topic: tlrTopic})

	vp := `{"VP":{"desi":"10B","dir":"2","oper":40,"veh":407,"tsi":1788721718,"spd":4.89,` +
		`"hdg":132,"lat":60.191122,"long":24.913142,"route":"1010B","oday":"2026-09-06","start":"22:00"}}`
	w.handleMessage(nil, &mockMessage{
		payload: []byte(vp),
		topic:   "/hfp/v2/journey/ongoing/vp/tram/0040/00407/1010B/2/Kolmikulma/22:00/1140441/4/60;24/19/91/13",
	})

	positions, err := memCache.GetAllPositions(context.Background())
	if err != nil {
		t.Fatalf("unexpected cache error: %v", err)
	}
	raw, ok := positions["0040-407"]
	if !ok {
		t.Fatalf("no position cached for the tram, got %v", positions)
	}
	var got VehiclePosition
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal cached position: %v", err)
	}
	if got.Tlp == nil {
		t.Fatal("position carries no priority state")
	}
	if got.Tlp.Status != TLPRequesting || got.Tlp.Junction == nil || *got.Tlp.Junction != 75 {
		t.Errorf("tlp = %+v, want a request at junction 75", got.Tlp)
	}
}

// A vehicle that has not asked anything recently must not carry an empty `tlp`
// object on every message it sends — most of the fleet, most of the time.
func TestHandleMessage_OmitsPriorityWhenSilent(t *testing.T) {
	memCache := cache.NewMemoryCache()
	w := NewIngestionWorker("tls://mock:8883", memCache)

	vp := `{"VP":{"desi":"9","veh":229,"tsi":1781461815,"spd":8.5,"hdg":145,` +
		`"lat":60.16985,"long":24.93848,"route":"HSL:1009"}}`
	w.handleMessage(nil, &mockMessage{
		payload: []byte(vp),
		topic:   "/hfp/v2/journey/ongoing/vp/tram/0022/00229/HSL:1009/1/Jätkäsaari/09:15/1203420/4/60;24/19/65/90",
	})

	positions, _ := memCache.GetAllPositions(context.Background())
	raw := positions["0022-229"]
	if raw == nil {
		t.Fatalf("no position cached, got %v", positions)
	}
	if got := string(raw); strings.Contains(got, `"tlp"`) {
		t.Errorf("position carries a tlp key with nothing to report: %s", got)
	}
}

func TestTLPTopicsFor(t *testing.T) {
	for _, mode := range []string{"tram", "bus"} {
		if got := tlpTopicsFor(mode); len(got) != 2 {
			t.Errorf("tlpTopicsFor(%q) = %v, want a tlr and a tla topic", mode, got)
		}
	}
	// Metro publishes no events at all, and a commuter train does not ask a
	// street junction for anything.
	for _, mode := range []string{"metro", "train", "ferry"} {
		if got := tlpTopicsFor(mode); got != nil {
			t.Errorf("tlpTopicsFor(%q) = %v, want none", mode, got)
		}
	}
}

func TestParseTLPJunction(t *testing.T) {
	if got := parseTLPJunction(strings.Split(tlaTopic, "/")); got == nil || *got != 75 {
		t.Errorf("junction = %v, want 75", got)
	}
	// A vp topic has no junction level at all.
	short := strings.Split("/hfp/v2/journey/ongoing/vp/tram/0040/00407/1010B/2/Kolmikulma/22:00/1140441/4/60;24/19/91/13", "/")
	if got := parseTLPJunction(short); got != nil {
		t.Errorf("junction = %v, want none for a topic without one", got)
	}
}
