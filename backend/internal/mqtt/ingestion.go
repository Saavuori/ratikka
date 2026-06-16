package mqtt

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/prometheus/client_golang/prometheus"
	"ratikka/internal/cache"
)

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
		Dl    int         `json:"dl"`
		Drst  int         `json:"drst"`
		Route string      `json:"route"`
		Stop  interface{} `json:"stop"`
		Tsi   int64       `json:"tsi"`
		Dir   string      `json:"dir"`
		Oday  string      `json:"oday"`
		Start string      `json:"start"`
	} `json:"VP"`
}

// VehiclePosition is the thinned down position payload sent to clients and stored in cache
type VehiclePosition struct {
	Veh    string  `json:"veh"`
	Desi   string  `json:"desi"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Hdg    int     `json:"hdg"`
	Spd    float64 `json:"spd"`
	Dl     int     `json:"dl"`
	Drst   int     `json:"drst"`
	Route  string  `json:"route"`
	Stop   *string `json:"stop"`
	Ts     int64   `json:"ts"`
	TripId string  `json:"tripId"`
	Mode   string  `json:"mode"`
}

type IngestionWorker struct {
	client mqtt.Client
	cache  cache.Cache
	broker string
}

func NewIngestionWorker(broker string, cache cache.Cache) *IngestionWorker {
	return &IngestionWorker{
		broker: broker,
		cache:  cache,
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

	// Callback when connection is established (or re-established)
	opts.OnConnect = func(client mqtt.Client) {
		log.Println("MQTT connected to broker:", w.broker)
		topics := map[string]byte{
			"/hfp/v2/journey/ongoing/vp/tram/#": 0,
			"/hfp/v2/journey/ongoing/vp/bus/#":  0,
		}
		token := client.SubscribeMultiple(topics, w.handleMessage)
		if token.Wait() && token.Error() != nil {
			log.Printf("Failed to subscribe to topics: %v\n", token.Error())
		} else {
			log.Println("Successfully subscribed to topics")
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

	routeLabel := vp.Route
	if routeLabel == "" {
		routeLabel = "unknown"
	}
	MessagesReceivedCounter.WithLabelValues(routeLabel).Inc()

	// Determine mode from topic: /hfp/v2/journey/ongoing/vp/<mode>/...
	parts := strings.Split(msg.Topic(), "/")
	mode := "tram"
	if len(parts) > 6 {
		mode = parts[6]
	}

	operator := "unknown"
	if len(parts) > 7 {
		operator = parts[7]
	}
	vehicleID := fmt.Sprintf("%s-%d", operator, vp.Veh)

	if mode != "tram" {
		log.Printf("MQTT ingestion: received message for mode=%s, topic=%s\n", mode, msg.Topic())
	}

	thinned := VehiclePosition{
		Veh:    vehicleID,
		Desi:   vp.Desi,
		Lat:    vp.Lat,
		Lng:    vp.Long, // Translate "long" in HFP to "lng" in internal api
		Hdg:    vp.Hdg,
		Spd:    vp.Spd,
		Dl:     vp.Dl,
		Drst:   vp.Drst,
		Route:  vp.Route,
		Stop:   stopStr,
		Ts:     vp.Tsi,
		TripId: tripId,
		Mode:   mode,
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
}

func constructGTFSTripID(route, oday, dir, start string) string {
	// Strip HSL: prefix from route if present
	r := route
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
