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
	// Empty — the default — records nothing, because an instance without a
	// volume mounted for it would otherwise fill its own container layer.
	ReplayDir string
	// ReplayRetentionDays is how far back the history reaches. A week of trams
	// is about 1.1 GB.
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

