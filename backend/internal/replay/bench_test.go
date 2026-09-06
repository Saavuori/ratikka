package replay

import (
	"fmt"
	"testing"
	"time"
)

// BenchmarkBBoxScan measures the claim the packed layout is built on: that a
// bounding-box query can walk the whole archive rather than needing a spatial
// index. One minute of trams is ~4,900 readings, so scale the reported
// nanoseconds by 10,080 minutes to get a week.
func BenchmarkBBoxScan(b *testing.B) {
	root := b.TempDir()
	a, err := Open(Config{Root: root, RetentionDays: 7, Modes: []string{"tram"}})
	if err != nil {
		b.Fatalf("Open: %v", err)
	}
	defer a.Close()

	base := time.Date(2026, 9, 6, 17, 0, 0, 0, Helsinki)
	const vehicles, seconds = 82, 60
	for v := range vehicles {
		for s := range seconds {
			pos := samplePosition(base.Add(time.Duration(s)*time.Second),
				fmt.Sprintf("0040-%d", v), 60.15+float64(v)*1e-3, 24.90+float64(s)*1e-3)
			if err := a.Record(pos); err != nil {
				b.Fatalf("Record: %v", err)
			}
		}
	}
	if err := a.Flush(); err != nil {
		b.Fatalf("Flush: %v", err)
	}

	// Two shapes of the same query. "junction" is what a timelapse actually
	// asks — a few hundred metres, almost everything rejected — and isolates
	// the cost of the scan itself. "district" keeps a good fraction of the
	// readings and so also pays for materialising the hits.
	for _, tc := range []struct {
		name string
		box  BBox
	}{
		{"junction", BBox{West: 24.930, South: 60.160, East: 24.935, North: 60.163}},
		{"district", BBox{West: 24.90, South: 60.15, East: 24.96, North: 60.20}},
	} {
		query := Query{From: base, To: base.Add(time.Minute), BBox: &tc.box}
		b.Run(tc.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				res, err := a.Read(query)
				if err != nil {
					b.Fatalf("Read: %v", err)
				}
				if res.Scanned != vehicles*seconds {
					b.Fatalf("scanned %d, want %d", res.Scanned, vehicles*seconds)
				}
			}
		})
	}
}
