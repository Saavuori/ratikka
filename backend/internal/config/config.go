package config

import (
	"flag"
	"os"
)

type Config struct {
	DigitransitAPIKey string
	RedisURL          string
	MQTTBroker        string
	Port              string
	NoRedis           bool
}

func LoadConfig() *Config {
	cfg := &Config{
		DigitransitAPIKey: os.Getenv("DIGITRANSIT_API_KEY"),
		RedisURL:          os.Getenv("REDIS_URL"),
		MQTTBroker:        os.Getenv("MQTT_BROKER"),
		Port:              os.Getenv("PORT"),
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
