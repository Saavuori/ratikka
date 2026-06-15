package api

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
)

//go:embed all:dist
var distFS embed.FS

func ServeStatic(w http.ResponseWriter, r *http.Request) {
	// Get the sub-filesystem for the "dist" folder
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		log.Printf("failed to get dist FS sub: %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	// Serve static files
	fileServer := http.FileServer(http.FS(sub))
	fileServer.ServeHTTP(w, r)
}
