package influx

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

var (
	// PointsWrittenCounter counts points InfluxDB accepted. Paired with
	// ratikka_replay_readings_recorded_total it says whether the two sinks see
	// the same feed.
	PointsWrittenCounter = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "ratikka_influx_points_written_total",
		Help: "Total number of points accepted by InfluxDB.",
	})

	// PointsDroppedCounter counts points that never made it, by why: the
	// buffer overflowed while InfluxDB was unreachable, or InfluxDB refused
	// the batch outright (bad token, missing bucket, malformed point).
	PointsDroppedCounter = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "ratikka_influx_points_dropped_total",
		Help: "Total number of points discarded without being written to InfluxDB.",
	}, []string{"reason"})

	// WriteErrorsCounter counts failed write requests, retried or not.
	WriteErrorsCounter = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "ratikka_influx_write_errors_total",
		Help: "Total number of InfluxDB write requests that failed.",
	})
)

func init() {
	prometheus.MustRegister(PointsWrittenCounter)
	prometheus.MustRegister(PointsDroppedCounter)
	prometheus.MustRegister(WriteErrorsCounter)
}

// Config says where points go. An empty URL turns the writer off.
type Config struct {
	URL    string
	Token  string
	Org    string
	Bucket string
	// Modes are the vehicle modes written.
	Modes []string

	// BatchSize is the most points sent in one request; FlushInterval is the
	// longest a point waits for its batch to fill. MaxBuffer bounds what is
	// held while InfluxDB is unreachable — beyond it the oldest points go.
	BatchSize     int
	FlushInterval time.Duration
	MaxBuffer     int

	Client *http.Client
}

// Writer queues points and writes them to InfluxDB in batches from its own
// goroutine. Enqueueing never blocks: the MQTT receive path must not wait on
// a database, so when the queue is full the point is dropped and counted.
//
// A nil *Writer is a writer that is switched off, and every method tolerates
// it, so callers need no branch.
type Writer struct {
	endpoint string
	token    string
	modes    map[string]bool

	batchSize     int
	flushInterval time.Duration
	maxBuffer     int
	client        *http.Client

	queue chan []byte
	done  chan struct{}
}

// New returns a writer for cfg, or nil when cfg.URL is empty.
func New(cfg Config) (*Writer, error) {
	if strings.TrimSpace(cfg.URL) == "" {
		return nil, nil
	}
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(cfg.URL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("unusable InfluxDB URL %q", cfg.URL)
	}
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("no InfluxDB bucket configured")
	}

	q := url.Values{}
	q.Set("bucket", cfg.Bucket)
	if cfg.Org != "" {
		q.Set("org", cfg.Org)
	}
	q.Set("precision", "s")
	base.Path += "/api/v2/write"
	base.RawQuery = q.Encode()

	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 5000
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 10 * time.Second
	}
	if cfg.MaxBuffer <= 0 {
		// Trams arrive at about 80 points a second, so this rides out a
		// quarter of an hour of InfluxDB being away.
		cfg.MaxBuffer = 100_000
	}
	if cfg.Client == nil {
		cfg.Client = &http.Client{Timeout: 30 * time.Second}
	}

	modes := make(map[string]bool, len(cfg.Modes))
	for _, m := range cfg.Modes {
		modes[m] = true
	}

	return &Writer{
		endpoint:      base.String(),
		token:         cfg.Token,
		modes:         modes,
		batchSize:     cfg.BatchSize,
		flushInterval: cfg.FlushInterval,
		maxBuffer:     cfg.MaxBuffer,
		client:        cfg.Client,
		// The channel only has to absorb what arrives during one request;
		// the backlog proper is kept in Run's pending slice.
		queue: make(chan []byte, cfg.BatchSize*2),
		done:  make(chan struct{}),
	}, nil
}

// Enabled reports whether points are being written anywhere.
func (w *Writer) Enabled() bool { return w != nil }

// Records reports whether readings of this mode are written.
func (w *Writer) Records(mode string) bool { return w != nil && w.modes[mode] }

// Modes lists the modes written, for logging.
func (w *Writer) Modes() []string {
	if w == nil {
		return nil
	}
	out := make([]string, 0, len(w.modes))
	for m := range w.modes {
		out = append(out, m)
	}
	return out
}

// Endpoint is the write URL, which carries no credentials and is safe to log.
func (w *Writer) Endpoint() string {
	if w == nil {
		return ""
	}
	return w.endpoint
}

// Write queues one finished line. It never blocks.
func (w *Writer) Write(line []byte) {
	if w == nil || line == nil {
		return
	}
	select {
	case w.queue <- line:
	default:
		PointsDroppedCounter.WithLabelValues("queue_full").Inc()
	}
}

// Run drains the queue into batched writes until ctx is cancelled, then makes
// one last attempt to write what is left. Call it once, in its own goroutine.
func (w *Writer) Run(ctx context.Context) {
	if w == nil {
		return
	}
	defer close(w.done)

	ticker := time.NewTicker(w.flushInterval)
	defer ticker.Stop()

	var pending [][]byte
	// After a failure, wait for the next tick rather than hammering a database
	// that just said no with every point that arrives.
	backoff := false

	for {
		select {
		case <-ctx.Done():
		drain:
			for {
				select {
				case line := <-w.queue:
					pending = append(pending, line)
				default:
					break drain
				}
			}
			final, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			pending = w.flush(final, pending)
			cancel()
			if len(pending) > 0 {
				PointsDroppedCounter.WithLabelValues("shutdown").Add(float64(len(pending)))
			}
			return

		case line := <-w.queue:
			pending = append(pending, line)
			if over := len(pending) - w.maxBuffer; over > 0 {
				PointsDroppedCounter.WithLabelValues("buffer_full").Add(float64(over))
				pending = pending[over:]
			}
			if !backoff && len(pending) >= w.batchSize {
				pending = w.flush(ctx, pending)
				backoff = len(pending) >= w.batchSize
			}

		case <-ticker.C:
			pending = w.flush(ctx, pending)
			backoff = len(pending) > 0
		}
	}
}

// Wait blocks until Run has returned.
func (w *Writer) Wait() {
	if w == nil {
		return
	}
	<-w.done
}

// flush sends pending in batches, oldest first, and returns what could not be
// sent. It stops at the first batch that fails and could succeed on a retry.
func (w *Writer) flush(ctx context.Context, pending [][]byte) [][]byte {
	for len(pending) > 0 {
		n := min(len(pending), w.batchSize)
		retry, err := w.send(ctx, pending[:n])
		if err != nil {
			WriteErrorsCounter.Inc()
			log.Printf("InfluxDB write of %d points failed: %v\n", n, err)
			if retry {
				break
			}
			PointsDroppedCounter.WithLabelValues("rejected").Add(float64(n))
		} else {
			PointsWrittenCounter.Add(float64(n))
		}
		pending = pending[n:]
	}
	// Let go of the backing array once it has been drained, so a burst
	// during an outage does not stay allocated for the life of the process.
	if len(pending) == 0 {
		return nil
	}
	return pending
}

// send writes one batch. It reports whether a failure is worth retrying:
// network errors, 429 and 5xx are; anything else InfluxDB said no to will
// be said no to again.
func (w *Writer) send(ctx context.Context, lines [][]byte) (retry bool, err error) {
	var body bytes.Buffer
	zw := gzip.NewWriter(&body)
	for _, l := range lines {
		zw.Write(l)
		zw.Write([]byte{'\n'})
	}
	if err := zw.Close(); err != nil {
		return false, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.endpoint, &body)
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	req.Header.Set("Content-Encoding", "gzip")
	if w.token != "" {
		req.Header.Set("Authorization", "Token "+w.token)
	}

	resp, err := w.client.Do(req)
	if err != nil {
		return true, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 == 2 {
		io.Copy(io.Discard, resp.Body)
		return false, nil
	}
	msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	retry = resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500
	return retry, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
}
