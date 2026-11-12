package main

import (
	"fmt"
	"net/url"
	"regexp"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// Every setting comes from env (ADR-0011); a value it can't use stops it at startup.
type config struct {
	serverID     string // which numbered game server this is (ADR-0033)
	port         int
	ticketSecret []byte // shared with the web app, which signs match tickets
	valkeyURL    string // where the web app leaves each match (Q-P3-22)
	// P5-W31-S02b-2 (ADR-0041): Velox, which judges battle code. Optional: a server
	// without it plays quiz matches and refuses battles.
	veloxURL    string
	veloxAPIKey string
}

var serverIDPattern = regexp.MustCompile(`^[0-9]+$`)

func loadConfig(getenv func(string) string) (config, error) {
	cfg := config{serverID: getenv("GAME_SERVER_ID"), port: 8080}
	if !serverIDPattern.MatchString(cfg.serverID) {
		return config{}, fmt.Errorf("GAME_SERVER_ID must be a number, got %q", cfg.serverID)
	}
	secret := getenv("GAME_TICKET_SECRET")
	if len(secret) < 32 {
		return config{}, fmt.Errorf("GAME_TICKET_SECRET must be at least 32 characters")
	}
	cfg.ticketSecret = []byte(secret)
	cfg.valkeyURL = getenv("VALKEY_URL")
	if _, err := redis.ParseURL(cfg.valkeyURL); err != nil {
		return config{}, fmt.Errorf("VALKEY_URL must be a redis:// or rediss:// URL")
	}
	cfg.veloxURL, cfg.veloxAPIKey = getenv("VELOX_URL"), getenv("VELOX_API_KEY")
	if cfg.veloxURL != "" {
		u, err := url.Parse(cfg.veloxURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return config{}, fmt.Errorf("VELOX_URL must be an http(s) URL")
		}
		if cfg.veloxAPIKey == "" {
			return config{}, fmt.Errorf("VELOX_API_KEY is needed with VELOX_URL")
		}
	}
	if raw := getenv("PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port < 1 || port > 65535 {
			return config{}, fmt.Errorf("PORT must be 1 to 65535, got %q", raw)
		}
		cfg.port = port
	}
	return cfg, nil
}
