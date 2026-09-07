package config

import (
	"bufio"
	"flag"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	DigitransitAPIKey string
	RedisURL          string
	MQTTBroker        string
	Port              string
	NoRedis           bool

	// ReplayDir is where the rolling history of vehicle positions is written.
	// Recording is on by default, into DefaultReplayDir: an instance that never
	// sets the variable still has a timelapse, which is the whole point of the
	// feature. REPLAY_DIR=off records nothing.
	ReplayDir string
	// ReplayRetentionDays is how far back the history reaches. A week of trams
	// is about 1.1 GB — which is why an instance that named no directory keeps
	// DefaultUnconfiguredRetentionDays instead: with no volume mounted the
	// archive lands in the container's own layer, and a day of trams (~160 MB)
	// is a size that layer can carry and a deploy can afford to lose.
	ReplayRetentionDays int
	// ReplayModes are the vehicle modes recorded. Trams only by default: they
	// are the one mode ingested unconditionally, so theirs is the only history
	// without holes wherever nobody happened to be watching.
	ReplayModes []string
}

// loadDotEnv tries to find and parse a .env file from common locations and sets env vars
func loadDotEnv() {
	wd, _ := os.Getwd()
	log.Printf("Current working directory: %s\n", wd)

	paths := []string{".env", "../.env", "backend/.env", "../backend/.env"}
	var file *os.File
	var err error
	var foundPath string
	for _, path := range paths {
		absPath, _ := filepath.Abs(path)
		file, err = os.Open(path)
		if err == nil {
			foundPath = absPath
			break
		} else {
			log.Printf("Tried .env path %s (abs: %s): %v\n", path, absPath, err)
		}
	}
	if file == nil {
		log.Println("No .env file could be opened")
		return
	}
	defer file.Close()
	log.Printf("Loading environment variables from: %s\n", foundPath)

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		// Remove quotes if present
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		// Never log the values: .env entries include API keys and tokens.
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
			log.Printf("Set env: %s\n", key)
		} else {
			log.Printf("Env %s already set, skipping .env value\n", key)
		}
	}
}

// parsePositiveInt reads a whole-number setting, falling back to a default for
// anything missing, unparseable or non-positive.
func parsePositiveInt(raw string, fallback int) int {
	v, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || v <= 0 {
		if strings.TrimSpace(raw) != "" && (err != nil || v <= 0) {
			log.Printf("Ignoring unusable value %q, using %d\n", raw, fallback)
		}
		return fallback
	}
	return v
}

// parseModes reads a comma-separated mode list, defaulting to trams alone.
func parseModes(raw string) []string {
	var modes []string
	for _, part := range strings.Split(raw, ",") {
		if mode := strings.TrimSpace(part); mode != "" {
			modes = append(modes, mode)
		}
	}
	if len(modes) == 0 {
		return []string{"tram"}
	}
	return modes
}

// DefaultReplayDir is where history goes when REPLAY_DIR says nothing. The
// deployment's compose file mounts a volume here; an instance without one still
// records, into its own container layer, at the shorter retention below.
const DefaultReplayDir = "/data/replay"

// DefaultUnconfiguredRetentionDays is how much history an instance keeps when it
// never named a directory to keep it in.
const DefaultUnconfiguredRetentionDays = 1

// ReplayOff reports whether REPLAY_DIR is the explicit opt-out. Recording is on
// by default, so switching it off takes a word rather than an empty string.
func ReplayOff(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "off", "none", "no", "false", "0", "-":
		return true
	}
	return false
}

func LoadConfig() *Config {
	loadDotEnv()


	cfg := &Config{
		DigitransitAPIKey:   os.Getenv("DIGITRANSIT_API_KEY"),
		RedisURL:            os.Getenv("REDIS_URL"),
		MQTTBroker:          os.Getenv("MQTT_BROKER"),
		Port:                os.Getenv("PORT"),
		ReplayDir:           os.Getenv("REPLAY_DIR"),
		ReplayRetentionDays: parsePositiveInt(os.Getenv("REPLAY_RETENTION_DAYS"), 7),
		ReplayModes:         parseModes(os.Getenv("REPLAY_MODES")),
	}

	// Recording defaults on. An instance that named no directory gets the
	// default one and a day of history rather than a week, because with no
	// volume mounted there the archive is writing into the container's own
	// layer. An explicit REPLAY_DIR is a deployment that has decided where its
	// history lives, and keeps whatever retention it asked for.
	if ReplayOff(os.Getenv("REPLAY_DIR")) {
		cfg.ReplayDir = ""
	} else if cfg.ReplayDir == "" {
		cfg.ReplayDir = DefaultReplayDir
		if os.Getenv("REPLAY_RETENTION_DAYS") == "" {
			cfg.ReplayRetentionDays = DefaultUnconfiguredRetentionDays
		}
	}

	// Fallback/defaults
	if cfg.RedisURL == "" {
		cfg.RedisURL = "redis://ratikka-cache:6379"
	}
	if cfg.MQTTBroker == "" {
		cfg.MQTTBroker = "tls://mqtt.hsl.fi:8883"
	}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}

	// Command line flags overrides
	fs := flag.NewFlagSet("ratikka", flag.ContinueOnError)
	noRedisFlag := fs.Bool("no-redis", false, "Use in-memory map instead of Redis")
	
	// Filter out go test flags to prevent parsing warnings
	var args []string
	for _, arg := range os.Args[1:] {
		// Go test binary injects flags starting with -test.
		if len(arg) < 6 || arg[:6] != "-test." {
			args = append(args, arg)
		}
	}
	_ = fs.Parse(args)

	cfg.NoRedis = *noRedisFlag

	// Also check environment variable for no-redis
	if os.Getenv("NO_REDIS") == "true" {
		cfg.NoRedis = true
	}

	return cfg
}

