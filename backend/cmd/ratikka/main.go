package main

import (
	"context"
	"encoding/json"
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
	"ratikka/internal/replay"
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

	// 4. Open the replay archive, if one is configured. A nil archive records
	// nothing and every method tolerates it, so the rest of the wiring is the
	// same whether recording is on or off.
	archive, err := replay.Open(replay.Config{
		Root:          cfg.ReplayDir,
		RetentionDays: cfg.ReplayRetentionDays,
		Modes:         cfg.ReplayModes,
	})
	if err != nil {
		log.Printf("WARNING: replay archive unavailable: %v. History will not be recorded.\n", err)
	} else if archive.Enabled() {
		log.Printf("Recording %v history to %s, keeping %d days\n",
			archive.Modes(), cfg.ReplayDir, archive.RetentionDays())
	} else {
		log.Println("Replay archive disabled (REPLAY_DIR is unset). History will not be recorded.")
	}
	defer archive.Close()

	// 5. Initialize MQTT Ingestion Worker
	log.Printf("Starting MQTT ingestion from broker: %s...\n", cfg.MQTTBroker)
	mqttWorker := mqtt.NewIngestionWorker(cfg.MQTTBroker, liveCache)
	mqttWorker.SetArchive(archive)
	if err := mqttWorker.Start(ctx); err != nil {
		log.Printf("ERROR starting MQTT worker: %v\n", err)
	}
	defer mqttWorker.Stop()

	// 6. Initialize WebSocket Hub. It drives on-demand bus ingestion: buses are
	// only streamed while at least one connected client has opted in.
	wsHub := ws.NewHub(liveCache)
	wsHub.SetModeController(mqttWorker)
	go wsHub.Run(ctx)

	// Spawn background stale vehicle cleanup (older than 60 seconds)
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cleanupStaleTrams(ctx, liveCache)
			}
		}
	}()

	// Push buffered history to disk, and drop days that have aged out. The
	// flush bounds what a crash costs to a few seconds of history; the sweep
	// runs rarely because it walks the whole archive.
	if archive.Enabled() {
		go func() {
			flush := time.NewTicker(5 * time.Second)
			defer flush.Stop()
			sweep := time.NewTicker(10 * time.Minute)
			defer sweep.Stop()

			if _, err := archive.Sweep(); err != nil {
				log.Printf("Replay archive sweep failed: %v\n", err)
			}

			for {
				select {
				case <-ctx.Done():
					return
				case <-flush.C:
					if err := archive.Flush(); err != nil {
						log.Printf("Replay archive flush failed: %v\n", err)
					}
				case <-sweep.C:
					bytes, err := archive.Sweep()
					if err != nil {
						log.Printf("Replay archive sweep failed: %v\n", err)
						continue
					}
					log.Printf("Replay archive holds %.1f MB\n", float64(bytes)/(1<<20))
				}
			}
		}()
	}

	// 7. Setup REST Handlers & GraphQL API Client
	gqlClient := api.NewGraphQLClient(cfg.DigitransitAPIKey)
	handlers := api.NewHandlers(liveCache, gqlClient, mqttWorker)
	handlers.SetArchive(archive)

	// 8. Setup router
	router := api.NewRouter(handlers, wsHub)

	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
		// No global Read/WriteTimeout: the /api/v1/stream WebSocket is a
		// long-lived connection. ReadHeaderTimeout still guards against
		// slowloris-style clients dribbling request headers.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// 9. Handle OS shutdown signals for graceful termination
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

func cleanupStaleTrams(ctx context.Context, c cache.Cache) {
	positions, err := c.GetAllPositions(ctx)
	if err != nil {
		log.Printf("Cleanup error getting positions: %v\n", err)
		return
	}

	now := time.Now().Unix()
	const staleThresholdSeconds = 60 // 1 minute stale limit

	for vehicleID, payload := range positions {
		var pos struct {
			Ts int64 `json:"ts"`
		}
		if err := json.Unmarshal(payload, &pos); err != nil {
			log.Printf("Cleanup error unmarshaling position for vehicle %s: %v\n", vehicleID, err)
			continue
		}

		if now-pos.Ts > staleThresholdSeconds {
			if err := c.DeletePosition(ctx, vehicleID); err != nil {
				log.Printf("Cleanup error deleting stale vehicle %s: %v\n", vehicleID, err)
			} else {
				log.Printf("Cleaned up stale vehicle %s (inactive for %d seconds)\n", vehicleID, now-pos.Ts)
			}
		}
	}
}
