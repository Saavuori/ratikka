package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func testStaticFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":          {Data: []byte("<!doctype html><script src=/assets/index-abc.js></script>")},
		"assets/index-abc.js": {Data: []byte("console.log(1)")},
		"style.json":          {Data: []byte("{}")},
	}
}

func serveStatic(t *testing.T, h http.Handler, target string, header http.Header) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	for k, v := range header {
		req.Header[k] = v
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestStaticHashedAssetsAreImmutable(t *testing.T) {
	h := newStaticHandler(testStaticFS())
	rec := serveStatic(t, h, "/assets/index-abc.js", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != immutableCache {
		t.Errorf("Cache-Control = %q, want %q", got, immutableCache)
	}
	if rec.Header().Get("ETag") == "" {
		t.Error("hashed asset served without an ETag")
	}
}

func TestStaticIndexRevalidatesAndAnswers304(t *testing.T) {
	h := newStaticHandler(testStaticFS())
	first := serveStatic(t, h, "/", nil)
	if first.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", first.Code)
	}
	if got := first.Header().Get("Cache-Control"); got != revalidateCache {
		t.Errorf("Cache-Control = %q, want %q", got, revalidateCache)
	}
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("index served without an ETag")
	}

	again := serveStatic(t, h, "/", http.Header{"If-None-Match": {etag}})
	if again.Code != http.StatusNotModified {
		t.Errorf("revalidation status = %d, want 304", again.Code)
	}
	if again.Body.Len() != 0 {
		t.Errorf("304 carried a %d-byte body", again.Body.Len())
	}
}

func TestStaticUnhashedFilesRevalidate(t *testing.T) {
	h := newStaticHandler(testStaticFS())
	rec := serveStatic(t, h, "/style.json", nil)
	if got := rec.Header().Get("Cache-Control"); got != revalidateCache {
		t.Errorf("Cache-Control = %q, want %q", got, revalidateCache)
	}
}

func TestStaticMissingFileIsNotCached(t *testing.T) {
	h := newStaticHandler(testStaticFS())
	rec := serveStatic(t, h, "/assets/gone-123.js", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("404 sent Cache-Control %q; a missing file must not be cached", got)
	}
}
