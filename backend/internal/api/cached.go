package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

// apiError is a build failure the caller should be told about in specific
// terms, rather than in the 502 an unrecognised failure gets.
type apiError struct {
	status  int
	message string
}

func (e apiError) Error() string { return e.message }

// notFound reports that the upstream does not have the thing that was asked
// for — an unknown trip, stop, route or station — which is the caller's
// mistake (404) and not the upstream's (502).
func notFound(what string) error {
	return apiError{status: http.StatusNotFound, message: what}
}

// errUpstream is what a handler returns when the reply should say only that
// the upstream failed. Digitransit's own error text can carry fragments of the
// query that produced it, so the endpoints that were already masking it keep
// masking it; the endpoints that pass their error through still do.
var errUpstream = apiError{status: http.StatusBadGateway, message: "upstream api error"}

// serveCached answers a request from the payload cache, and on a miss builds
// the payload once — however many requests are waiting on the same key — then
// caches it for ttl and writes it.
//
// The cache is read twice on purpose. Once before joining the singleflight
// group, so a key that is already warm never touches its bookkeeping; and
// again inside it, so the waiters a finished build releases write what it
// stored instead of each repeating the work.
//
// build returns the value to marshal. To fail with something other than a 502
// carrying the error's own text, return notFound or errUpstream.
func serveCached[T any](
	h *Handlers,
	w http.ResponseWriter,
	key string,
	ttl time.Duration,
	build func() (T, error),
) {
	if cached, ok := h.apiCache.Get(key); ok {
		writeJSONBytes(w, cached)
		return
	}

	payload, err, _ := h.sfGroup.Do(key, func() (any, error) {
		if cached, ok := h.apiCache.Get(key); ok {
			return cached, nil
		}

		value, err := build()
		if err != nil {
			return nil, err
		}

		body, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}

		h.apiCache.Set(key, body, ttl)
		return body, nil
	})

	if err != nil {
		var apiErr apiError
		if errors.As(err, &apiErr) {
			http.Error(w, apiErr.message, apiErr.status)
			return
		}
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	writeJSONBytes(w, payload.([]byte))
}

func writeJSONBytes(w http.ResponseWriter, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}
