package config

import (
	"os"
	"testing"
)

func TestLoadConfig_Defaults(t *testing.T) {
	// Clear environment variables
	os.Unsetenv("DIGITRANSIT_API_KEY")
	os.Unsetenv("REDIS_URL")
	os.Unsetenv("MQTT_BROKER")
	os.Unsetenv("PORT")
	os.Unsetenv("NO_REDIS")

	cfg := LoadConfig()

	if cfg.RedisURL != "redis://ratikka-cache:6379" {
		t.Errorf("expected default RedisURL, got %q", cfg.RedisURL)
	}
	if cfg.MQTTBroker != "tls://mqtt.hsl.fi:8883" {
		t.Errorf("expected default MQTTBroker, got %q", cfg.MQTTBroker)
	}
	if cfg.Port != "8080" {
		t.Errorf("expected default Port, got %q", cfg.Port)
	}
	if cfg.NoRedis != false {
		t.Errorf("expected NoRedis false, got %t", cfg.NoRedis)
	}
}

func TestLoadConfig_EnvOverrides(t *testing.T) {
	os.Setenv("DIGITRANSIT_API_KEY", "test-key")
	os.Setenv("REDIS_URL", "redis://localhost:9999")
	os.Setenv("MQTT_BROKER", "tcp://localhost:1883")
	os.Setenv("PORT", "3000")
	os.Setenv("NO_REDIS", "true")
	defer func() {
		os.Unsetenv("DIGITRANSIT_API_KEY")
		os.Unsetenv("REDIS_URL")
		os.Unsetenv("MQTT_BROKER")
		os.Unsetenv("PORT")
		os.Unsetenv("NO_REDIS")
	}()

	cfg := LoadConfig()

	if cfg.DigitransitAPIKey != "test-key" {
		t.Errorf("expected test-key, got %q", cfg.DigitransitAPIKey)
	}
	if cfg.RedisURL != "redis://localhost:9999" {
		t.Errorf("expected override, got %q", cfg.RedisURL)
	}
	if cfg.MQTTBroker != "tcp://localhost:1883" {
		t.Errorf("expected override, got %q", cfg.MQTTBroker)
	}
	if cfg.Port != "3000" {
		t.Errorf("expected 3000, got %q", cfg.Port)
	}
	if cfg.NoRedis != true {
		t.Errorf("expected NoRedis true, got %t", cfg.NoRedis)
	}
}
