package main

import (
	"fmt"
	"regexp"
	"strconv"
)

// Every setting comes from env (ADR-0011); a value it can't use stops it at startup.
type config struct {
	serverID     string // which numbered game server this is (ADR-0033)
	port         int
	ticketSecret []byte // shared with the web app, which signs match tickets
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
	if raw := getenv("PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port < 1 || port > 65535 {
			return config{}, fmt.Errorf("PORT must be 1 to 65535, got %q", raw)
		}
		cfg.port = port
	}
	return cfg, nil
}
