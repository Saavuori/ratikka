package replay

import "github.com/prometheus/client_golang/prometheus"

var (
	// RecordedCounter counts readings written to the archive, per mode. Paired
	// with the ingestion counter it says whether recording is keeping up.
	RecordedCounter = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "ratikka_replay_readings_recorded_total",
		Help: "Total number of vehicle readings appended to the replay archive.",
	}, []string{"mode"})

	// ArchiveBytesGauge is what the archive occupies on disk after the last
	// retention sweep. Alert on this rather than on the sweep running: a sweep
	// that runs and deletes nothing looks healthy right up until the volume is
	// full.
	ArchiveBytesGauge = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "ratikka_replay_archive_bytes",
		Help: "Bytes of vehicle history currently held in the replay archive.",
	})

	// QueryDurationHistogram measures how long archive reads take, split by
	// whether a bounding box was applied — the packed layout's whole claim is
	// that a boxed scan of a week stays interactive.
	QueryDurationHistogram = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "ratikka_replay_query_duration_seconds",
		Help:    "Time spent answering a replay archive query.",
		Buckets: []float64{0.001, 0.005, 0.02, 0.1, 0.5, 2, 10},
	}, []string{"kind"})
)

func init() {
	prometheus.MustRegister(RecordedCounter)
	prometheus.MustRegister(ArchiveBytesGauge)
	prometheus.MustRegister(QueryDurationHistogram)
}
