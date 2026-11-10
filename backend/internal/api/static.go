package api

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"log"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// immutableCache is sent with everything under /assets/. Vite names those
// files after a hash of their content, so a given URL can never come to mean
// different bytes: the browser may keep it for a year and never ask again.
const immutableCache = "public, max-age=31536000, immutable"

// revalidateCache is sent with everything else — index.html above all, which
// is what points at the current hashed assets and so has to be checked on
// every load. The check is cheap: the ETag lets an unchanged page come back
// as an empty 304.
const revalidateCache = "no-cache"

var staticHandler = newStaticHandler(mustSub(distFS, "dist"))

// ServeStatic serves the embedded frontend build.
func ServeStatic(w http.ResponseWriter, r *http.Request) {
	staticHandler.ServeHTTP(w, r)
}

func mustSub(fsys fs.FS, dir string) fs.FS {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		log.Fatalf("failed to get %s sub-filesystem: %v", dir, err)
	}
	return sub
}

// newStaticHandler serves fsys with caching headers.
//
// Files embedded in the binary carry no modification time, so on its own
// http.FileServer sends neither Last-Modified nor an ETag — and with no
// Cache-Control either, a browser has nothing to cache by and fetched the
// whole bundle again on every visit. The content hash of each file is
// computed once here, at startup (the embedded files cannot change while the
// process runs), and given as a strong ETag, which FileServer then honours
// for If-None-Match.
func newStaticHandler(fsys fs.FS) http.Handler {
	etags := make(map[string]string)
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		etags[p] = `"` + hex.EncodeToString(sum[:12]) + `"`
		return nil
	})
	if err != nil {
		log.Printf("static: hashing embedded files failed, serving without ETags: %v", err)
	}

	files := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := path.Clean(r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/") {
			name = path.Join(name, "index.html")
		}
		name = strings.TrimPrefix(name, "/")

		// Only files that exist get caching headers: a 404 must not be
		// remembered for a year.
		if etag, ok := etags[name]; ok {
			h := w.Header()
			h.Set("ETag", etag)
			if strings.HasPrefix(name, "assets/") {
				h.Set("Cache-Control", immutableCache)
			} else {
				h.Set("Cache-Control", revalidateCache)
			}
		}
		files.ServeHTTP(w, r)
	})
}
