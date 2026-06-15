package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ratikka/internal/api"
	"ratikka/internal/cache"
	"ratikka/internal/config"
	"ratikka/internal/mqtt"
	"ratikka/internal/ws"
)

func main() {
	log.Println("Starting Ratikka Live Tram Tracker backend...")

	// 1. Load config
	cfg := config.LoadConfig()

	// 2. Initialize Cache
	var liveCache cache.Cache
	if cfg.NoRedis {
		log.Println("Redis is disabled (--no-redis). Using in-memory cache.")
		liveCache = cache.NewMemoryCache()
	} else {
		log.Printf("Connecting to Redis at %s...\n", cfg.RedisURL)
		var err error
		liveCache, err = cache.NewRedisCache(cfg.RedisURL)
		if err != nil {
			log.Printf("WARNING: Redis connection failed: %v. Falling back to in-memory cache.\n", err)
			liveCache = cache.NewMemoryCache()
		} else {
			log.Println("Connected to Redis successfully.")
		}
	}
	defer liveCache.Close()

	// 3. Create context for background tasks lifecycle
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 4. Initialize MQTT Ingestion Worker
	log.Printf("Starting MQTT ingestion from broker: %s...\n", cfg.MQTTBroker)
	mqttWorker := mqtt.NewIngestionWorker(cfg.MQTTBroker, liveCache)
	if err := mqttWorker.Start(ctx); err != nil {
		log.Printf("ERROR starting MQTT worker: %v\n", err)
	}
	defer mqttWorker.Stop()

	// 5. Initialize WebSocket Hub
	wsHub := ws.NewHub(liveCache)
	go wsHub.Run(ctx)

	// 6. Setup REST Handlers & GraphQL API Client
	gqlClient := api.NewGraphQLClient(cfg.DigitransitAPIKey)
	handlers := api.NewHandlers(liveCache, gqlClient, mqttWorker)

	// 7. Setup router
	router := api.NewRouter(handlers, wsHub)

	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
	}

	// 8. Handle OS shutdown signals for graceful termination
	shutdownChan := make(chan os.Signal, 1)
	signal.Notify(shutdownChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("Listening on http://localhost:%s\n", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server listen failed: %v\n", err)
		}
	}()

	// Wait for termination signal
	sig := <-shutdownChan
	log.Printf("Received signal: %s. Initiating graceful shutdown...\n", sig)

	// Context with timeout to allow active requests to drain
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	// Cancel background routines
	cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server shutdown error: %v\n", err)
	}

	log.Println("Ratikka backend stopped.")
}
