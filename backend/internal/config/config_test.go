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

// Recording is on by default. An instance that says nothing about replay is the
// case this matters for: the deployment whose compose file predates the feature
// still records, and still has a timelapse to open.
func TestLoadConfig_ReplayDefaultsToRecording(t *testing.T) {
	os.Unsetenv("REPLAY_DIR")
	os.Unsetenv("REPLAY_RETENTION_DAYS")
	os.Unsetenv("REPLAY_MODES")

	cfg := LoadConfig()

	if cfg.ReplayDir != DefaultReplayDir {
		t.Errorf("expected default replay dir %q, got %q", DefaultReplayDir, cfg.ReplayDir)
	}
	// A day, not a week: with no volume mounted this is the container's own
	// layer, and a week of trams is about 1.1 GB.
	if cfg.ReplayRetentionDays != DefaultUnconfiguredRetentionDays {
		t.Errorf("expected %d days unconfigured, got %d",
			DefaultUnconfiguredRetentionDays, cfg.ReplayRetentionDays)
	}
	if len(cfg.ReplayModes) != 1 || cfg.ReplayModes[0] != "tram" {
		t.Errorf("expected trams alone, got %v", cfg.ReplayModes)
	}
}

// A deployment that named a directory has decided where its history lives, and
// keeps the retention it asked for rather than the cautious default.
func TestLoadConfig_ReplayDirKeepsItsOwnRetention(t *testing.T) {
	os.Setenv("REPLAY_DIR", "/data/replay")
	defer os.Unsetenv("REPLAY_DIR")
	os.Unsetenv("REPLAY_RETENTION_DAYS")

	cfg := LoadConfig()

	if cfg.ReplayDir != "/data/replay" {
		t.Errorf("expected the configured dir, got %q", cfg.ReplayDir)
	}
	if cfg.ReplayRetentionDays != 7 {
		t.Errorf("expected a week where the dir was configured, got %d", cfg.ReplayRetentionDays)
	}
}

func TestLoadConfig_ReplayCanBeTurnedOff(t *testing.T) {
	for _, off := range []string{"off", "none", "false", "0", " OFF "} {
		os.Setenv("REPLAY_DIR", off)
		cfg := LoadConfig()
		if cfg.ReplayDir != "" {
			t.Errorf("REPLAY_DIR=%q should record nothing, got %q", off, cfg.ReplayDir)
		}
	}
	os.Unsetenv("REPLAY_DIR")
}

// An explicit retention survives the default-directory path, so an instance can
// keep more (or less) history without naming a directory for it.
func TestLoadConfig_ReplayRetentionOverridesDefault(t *testing.T) {
	os.Unsetenv("REPLAY_DIR")
	os.Setenv("REPLAY_RETENTION_DAYS", "3")
	defer os.Unsetenv("REPLAY_RETENTION_DAYS")

	cfg := LoadConfig()

	if cfg.ReplayDir != DefaultReplayDir {
		t.Errorf("expected default replay dir, got %q", cfg.ReplayDir)
	}
	if cfg.ReplayRetentionDays != 3 {
		t.Errorf("expected the asked-for 3 days, got %d", cfg.ReplayRetentionDays)
	}
}
