package ws

import (
	"bytes"
	"compress/flate"
	"context"
	"fmt"
	"testing"
	"time"

	"ratikka/internal/cache"
)

// fleetCache fills a cache with a fleet the size of a weekday afternoon's:
// ~120 trams and ~700 buses, plus metro and trains, each a record of the size
// ingestion actually writes.
func fleetCache(b *testing.B) cache.Cache {
	b.Helper()
	c := cache.NewMemoryCache()
	add := func(mode string, n int) {
		for i := 0; i < n; i++ {
			id := fmt.Sprintf("%04d-%s%d", 40, mode, i)
			rec := fmt.Sprintf(`{"veh":%q,"desi":"10","lat":60.165037,"lng":24.943888,"hdg":174,"spd":0.01,"acc":0,"dl":168,"drst":1,"route":"1010","stop":"HSL:1030429","nextStop":"HSL:1030429","ts":1794327656,"tripId":"HSL:1010_20261110_Tu_2_1754","mode":%q,"odo":5968,"loc":"GPS","oper":40,"jrn":4343,"occu":0,"dir":"2","oday":"2026-11-10","start":"17:54","hw":{"ahead":"0040-439","secs":688,"sched":600,"state":"regular","stop":"HSL:1020464"}}`, id, mode)
			c.SetPosition(context.Background(), id, []byte(rec))
		}
	}
	add("tram", 120)
	add("bus", 700)
	add("metro", 13)
	add("train", 47)
	return c
}

// BenchmarkBroadcast is one tick for a mixed audience: most readers on trams
// alone, some with buses on too.
func BenchmarkBroadcast(b *testing.B) {
	hub := NewHub(fleetCache(b))
	for i := 0; i < 50; i++ {
		c := &Client{send: make(chan []byte, 1), wantsModes: map[string]bool{}}
		hub.addClient(c)
		if i%5 == 0 {
			c.wantsModes["bus"] = true
		}
	}
	ctx := context.Background()
	b.ReportAllocs()
	for b.Loop() {
		hub.broadcastSnapshot(ctx)
		hub.clientsMu.RLock()
		for c := range hub.clients {
			<-c.send
		}
		hub.clientsMu.RUnlock()
	}
}

// BenchmarkCompressPayload is what permessage-deflate costs per client per
// tick: coder/websocket compresses at flate.BestSpeed.
func BenchmarkCompressPayload(b *testing.B) {
	snap := newSnapshot(mustPositions(b), time.Unix(0, 0))
	for _, tc := range []struct {
		name  string
		wants map[string]bool
	}{
		{"trams", map[string]bool{}},
		{"all", map[string]bool{"bus": true, "metro": true, "train": true}},
	} {
		payload := snap.payload(tc.wants)
		b.Run(tc.name, func(b *testing.B) {
			var out bytes.Buffer
			w, _ := flate.NewWriter(&out, flate.BestSpeed)
			b.SetBytes(int64(len(payload)))
			for b.Loop() {
				out.Reset()
				w.Reset(&out)
				w.Write(payload)
				w.Flush()
			}
			b.ReportMetric(float64(out.Len()), "compressed-bytes")
			b.ReportMetric(float64(len(payload)), "raw-bytes")
		})
	}
}

func mustPositions(b *testing.B) map[string][]byte {
	p, err := fleetCache(b).GetAllPositions(context.Background())
	if err != nil {
		b.Fatal(err)
	}
	return p
}
