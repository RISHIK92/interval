// The game server (ARCH-2, LOAD-2, ADR-0033): one process owns each of its matches.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

const shutdownGrace = 10 * time.Second

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := loadConfig(os.Getenv)
	if err != nil {
		log.Error("game: bad config", "error", err.Error())
		os.Exit(2)
	}
	// The image has no shell or curl, so its health check is this binary.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if !healthy(cfg.port) {
			os.Exit(1)
		}
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	if err := run(ctx, cfg, os.Stdout); err != nil {
		log.Error("game: stopped on error", "error", err.Error())
		os.Exit(1)
	}
}

// Serves until ctx ends, then lets requests in flight finish for up to shutdownGrace.
// Shutdown doesn't wait for hijacked connections: the match sockets (P3-W15-S03) drain
// through RegisterOnShutdown or the match actor.
func run(ctx context.Context, cfg config, logs io.Writer) error {
	log := slog.New(slog.NewJSONHandler(logs, nil)).With("server", cfg.serverID)
	server := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.port),
		Handler:           newHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", server.Addr, err)
	}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	log.Info("game: serving", "port", cfg.port)

	select {
	case err := <-served:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	if err := server.Shutdown(shutdown); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-served; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	log.Info("game: stopped")
	return nil
}

func healthy(port int) bool {
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/healthz")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
