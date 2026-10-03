package influx

import (
	"compress/gzip"
	"context"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestLineEscapesAndTypes(t *testing.T) {
	got := string(NewLine("vehicle_position").
		Tag("veh", "0040-456").
		Tag("empty", "").
		Tag("headsign", "Katajanokan term., A=B").
		Float("speed", 8).
		Float("nan", math.NaN()).
		Int("delay", -45).
		Bool("doors_open", true).
		String("stop", `say "hi" \ bye`).
		String("none", "").
		End(1720000000))

	want := `vehicle_position,veh=0040-456,headsign=Katajanokan\ term.\,\ A\=B ` +
		`speed=8,delay=-45i,doors_open=true,stop="say \"hi\" \\ bye" 1720000000`
	if got != want {
		t.Errorf("line\n got %s\nwant %s", got, want)
	}
}

func TestLineWithoutFieldsIsNil(t *testing.T) {
	if l := NewLine("m").Tag("a", "b").End(1); l != nil {
		t.Errorf("expected nil for a point with no fields, got %q", l)
	}
}

func TestNilWriterIsOff(t *testing.T) {
	w, err := New(Config{})
	if err != nil || w != nil {
		t.Fatalf("empty URL should give a nil writer, got %v, %v", w, err)
	}
	// None of these may panic.
	w.Write([]byte("m f=1 1"))
	if w.Enabled() || w.Records("tram") {
		t.Error("nil writer claims to be on")
	}
	w.Run(context.Background())
	w.Wait()
}

type fakeInflux struct {
	mu     sync.Mutex
	status int
	lines  []string
	header http.Header
	query  string
}

func (f *fakeInflux) ServeHTTP(rw http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.header = r.Header.Clone()
	f.query = r.URL.RawQuery
	if f.status != 0 && f.status != http.StatusNoContent {
		rw.WriteHeader(f.status)
		return
	}
	zr, err := gzip.NewReader(r.Body)
	if err != nil {
		rw.WriteHeader(http.StatusBadRequest)
		return
	}
	body, _ := io.ReadAll(zr)
	for _, l := range strings.Split(strings.TrimSpace(string(body)), "\n") {
		f.lines = append(f.lines, l)
	}
	rw.WriteHeader(http.StatusNoContent)
}

func (f *fakeInflux) got() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.lines...)
}

func (f *fakeInflux) setStatus(s int) {
	f.mu.Lock()
	f.status = s
	f.mu.Unlock()
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestWriterBatchesAndAuthenticates(t *testing.T) {
	fake := &fakeInflux{}
	srv := httptest.NewServer(fake)
	defer srv.Close()

	w, err := New(Config{
		URL: srv.URL + "/", Token: "secret", Org: "home", Bucket: "ratikka",
		Modes: []string{"tram"}, BatchSize: 3, FlushInterval: time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !w.Records("tram") || w.Records("bus") {
		t.Error("mode filter wrong")
	}
	ctx, cancel := context.WithCancel(context.Background())
	go w.Run(ctx)

	for i := 0; i < 4; i++ {
		w.Write(NewLine("m").Int("i", int64(i)).End(int64(i)))
	}
	// Three fill a batch and go at once; the fourth waits for a flush.
	waitFor(t, func() bool { return len(fake.got()) == 3 })

	cancel()
	w.Wait()
	if got := fake.got(); len(got) != 4 || got[3] != "m i=3i 3" {
		t.Errorf("shutdown should flush the remainder, got %q", got)
	}
	if h := fake.header.Get("Authorization"); h != "Token secret" {
		t.Errorf("Authorization = %q", h)
	}
	for _, want := range []string{"bucket=ratikka", "org=home", "precision=s"} {
		if !strings.Contains(fake.query, want) {
			t.Errorf("query %q lacks %s", fake.query, want)
		}
	}
}

func TestWriterRetriesOutagesAndDropsRejections(t *testing.T) {
	fake := &fakeInflux{status: http.StatusServiceUnavailable}
	srv := httptest.NewServer(fake)
	defer srv.Close()

	w, _ := New(Config{URL: srv.URL, Bucket: "b", BatchSize: 1, FlushInterval: 20 * time.Millisecond})
	ctx, cancel := context.WithCancel(context.Background())
	go w.Run(ctx)

	// Unavailable: held, not lost.
	w.Write(NewLine("m").Int("i", 1).End(1))
	time.Sleep(60 * time.Millisecond)
	fake.setStatus(0)
	waitFor(t, func() bool { return len(fake.got()) == 1 })

	// Unauthorised: retrying would never help, so the point is dropped and the
	// next one still goes through.
	fake.setStatus(http.StatusUnauthorized)
	w.Write(NewLine("m").Int("i", 2).End(2))
	time.Sleep(60 * time.Millisecond)
	fake.setStatus(0)
	w.Write(NewLine("m").Int("i", 3).End(3))
	waitFor(t, func() bool { return len(fake.got()) == 2 })

	cancel()
	w.Wait()
	if got := fake.got(); got[1] != "m i=3i 3" {
		t.Errorf("got %q", got)
	}
}

func TestWriterBoundsItsBacklog(t *testing.T) {
	fake := &fakeInflux{status: http.StatusServiceUnavailable}
	srv := httptest.NewServer(fake)
	defer srv.Close()

	w, _ := New(Config{URL: srv.URL, Bucket: "b", BatchSize: 2, MaxBuffer: 3, FlushInterval: 20 * time.Millisecond})
	ctx, cancel := context.WithCancel(context.Background())
	go w.Run(ctx)

	for i := 0; i < 10; i++ {
		w.Write(NewLine("m").Int("i", int64(i)).End(int64(i)))
		time.Sleep(2 * time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond)
	fake.setStatus(0)
	cancel()
	w.Wait()

	// Only the newest three survive the outage.
	got := fake.got()
	if len(got) != 3 || got[0] != "m i=7i 7" || got[2] != "m i=9i 9" {
		t.Errorf("got %q", got)
	}
}
