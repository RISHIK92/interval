package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func testServer(t *testing.T, f fixtures) (*httptest.Server, *matchSockets) {
	t.Helper()
	sockets := newMatchSockets()
	cfg := config{serverID: f.Server, port: 0, ticketSecret: []byte(f.Secret)}
	srv := httptest.NewServer(newHandler(cfg, sockets, func() time.Time { return time.Unix(f.Now, 0) }))
	t.Cleanup(srv.Close)
	return srv, sockets
}

func socketURL(srv *httptest.Server, server, ticket string) string {
	return "ws" + strings.TrimPrefix(srv.URL, "http") + "/game/" + server + "/ws?ticket=" + url.QueryEscape(ticket)
}

func TestSocketRefusesBeforeUpgrading(t *testing.T) {
	f := loadFixtures(t)
	srv, _ := testServer(t, f)
	for _, tc := range []struct {
		path string
		want int
	}{
		{"/game/1/ws?ticket=" + url.QueryEscape(f.Valid), http.StatusNotFound},
		{"/game/0/ws", http.StatusUnauthorized},
		{"/game/0/ws?ticket=" + url.QueryEscape(f.Refused[0].Ticket), http.StatusUnauthorized},
		{"/game/0/ws?ticket=junk", http.StatusUnauthorized},
	} {
		resp, err := http.Get(srv.URL + tc.path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != tc.want {
			t.Errorf("%s: status %d, want %d", tc.path, resp.StatusCode, tc.want)
		}
	}
}

func TestSocketJoinsOnceThenRefusesTheSameTicket(t *testing.T) {
	f := loadFixtures(t)
	srv, sockets := testServer(t, f)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, socketURL(srv, "0", f.Valid), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var joined map[string]string
	if err := json.Unmarshal(data, &joined); err != nil {
		t.Fatal(err)
	}
	if joined["type"] != "joined" || joined["match"] != f.Claims.M {
		t.Fatalf("got %v", joined)
	}

	// Single use: the same ticket again is refused, even while the first socket is open.
	_, resp, err := websocket.Dial(ctx, socketURL(srv, "0", f.Valid), nil)
	if err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reuse: err %v, resp %v; want 401", err, resp)
	}

	// Shutting down closes the open socket (as RegisterOnShutdown runs it: alongside).
	go sockets.closeAll()
	if _, _, err := conn.Read(ctx); websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Fatalf("after shutdown: %v, want going away", err)
	}
}

// Through run, as main uses it: cancelling closes open sockets with "going away" before
// run returns, and a socket joining after that is closed at once.
func TestRunClosesMatchSocketsOnShutdown(t *testing.T) {
	f := loadFixtures(t)
	port := freePort(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	cfg := config{serverID: f.Server, port: port, ticketSecret: []byte(f.Secret)}
	go func() { done <- runAt(ctx, cfg, io.Discard, func() time.Time { return time.Unix(f.Now, 0) }) }()
	target := "ws://127.0.0.1:" + strconv.Itoa(port) + "/game/0/ws?ticket=" + url.QueryEscape(f.Valid)
	dial, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	var conn *websocket.Conn
	for {
		c, _, err := websocket.Dial(dial, target, nil)
		if err == nil {
			conn = c
			break
		}
		if dial.Err() != nil {
			t.Fatalf("never joined: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if _, _, err := conn.Read(dial); err != nil {
		t.Fatalf("joined message: %v", err)
	}
	cancel()
	if _, _, err := conn.Read(dial); websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Fatalf("got %v, want going away", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("run: %v", err)
	}
}

func TestLateJoinAfterCloseAllIsClosed(t *testing.T) {
	sockets := newMatchSockets()
	sockets.closeAll()
	if sockets.add(nil) {
		t.Fatal("a socket was kept after closing")
	}
}
