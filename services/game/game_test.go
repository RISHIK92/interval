package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// P3-W15-S01 (ADR-0033): config from env only (ADR-0011), a health endpoint, and a
// clean stop.

func env(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestConfigFromEnv(t *testing.T) {
	cfg, err := loadConfig(env(map[string]string{"GAME_SERVER_ID": "0"}))
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if cfg.serverID != "0" || cfg.port != 8080 {
		t.Fatalf("got %+v, want server 0 on 8080", cfg)
	}
	cfg, err = loadConfig(env(map[string]string{"GAME_SERVER_ID": "12", "PORT": "9000"}))
	if err != nil || cfg.serverID != "12" || cfg.port != 9000 {
		t.Fatalf("got %+v, %v; want server 12 on 9000", cfg, err)
	}
}

func TestConfigRefusesWhatItCannotUse(t *testing.T) {
	for _, tc := range []struct {
		values map[string]string
		names  string
	}{
		{map[string]string{}, "GAME_SERVER_ID"},
		{map[string]string{"GAME_SERVER_ID": "a"}, "GAME_SERVER_ID"},
		{map[string]string{"GAME_SERVER_ID": "-1"}, "GAME_SERVER_ID"},
		{map[string]string{"GAME_SERVER_ID": "0", "PORT": "x"}, "PORT"},
		{map[string]string{"GAME_SERVER_ID": "0", "PORT": "0"}, "PORT"},
		{map[string]string{"GAME_SERVER_ID": "0", "PORT": "70000"}, "PORT"},
	} {
		if _, err := loadConfig(env(tc.values)); err == nil || !strings.Contains(err.Error(), tc.names) {
			t.Errorf("%v: got %v, want an error naming %s", tc.values, err, tc.names)
		}
	}
}

func TestHealth(t *testing.T) {
	handler := newHandler()
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", rec.Code)
	}
	if body := strings.TrimSpace(rec.Body.String()); body != `{"status":"ok"}` {
		t.Fatalf("body %q", body)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control %q, want no-store", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type %q", got)
	}

	for _, req := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/", nil),
		httptest.NewRequest(http.MethodGet, "/game/0/ws", nil),
		httptest.NewRequest(http.MethodPost, "/healthz", nil),
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s %s: status %d, want 404 or 405", req.Method, req.URL.Path, rec.Code)
		}
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func TestRunServesThenStops(t *testing.T) {
	port := freePort(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- run(ctx, config{serverID: "0", port: port}, io.Discard) }()

	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/healthz"
	deadline := time.Now().Add(5 * time.Second)
	for {
		resp, err := http.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("status %d", resp.StatusCode)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("never served: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !healthy(port) {
		t.Fatal("healthcheck says unhealthy while serving")
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("run didn't stop")
	}
	if healthy(port) {
		t.Fatal("healthcheck says healthy after stopping")
	}
}
