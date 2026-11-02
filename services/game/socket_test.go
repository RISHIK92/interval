package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// The fixtures' match, its two players, with seven rounds.
func fixtureMatch(f fixtures) *memStore {
	def := sevenRounds()
	def.Players = []string{f.Claims.U, "user-2"}
	return newMemStore(map[string]matchDef{f.Claims.M: def})
}

func testServer(t *testing.T, f fixtures) (*httptest.Server, *matchSockets) {
	t.Helper()
	sockets := newMatchSockets()
	cfg := config{serverID: f.Server, port: 0, ticketSecret: []byte(f.Secret)}
	matches := newRegistry(fixtureMatch(f), realClock{}, slog.New(slog.DiscardHandler))
	t.Cleanup(matches.stopAll)
	srv := httptest.NewServer(newHandler(cfg, sockets, matches, func() time.Time { return time.Unix(f.Now, 0) }))
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
	go func() {
		done <- runAt(ctx, cfg, io.Discard, func() time.Time { return time.Unix(f.Now, 0) }, fixtureMatch(f))
	}()
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

// Signs a ticket as the web app does (apps/web/src/server/tickets.ts), for players the
// fixtures don't carry.
func signForTest(t *testing.T, c claims, secret string) string {
	t.Helper()
	payload, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	body := "v1." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// Two real players through the handler: rounds arrive without keys, answers are taken,
// and an unknown match closes the socket.
func TestTwoPlayersPlayARound(t *testing.T) {
	f := loadFixtures(t)
	srv, _ := testServer(t, f)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	bobTicket := signForTest(t, claims{M: f.Claims.M, U: "user-2", S: "0", E: f.Now + 60, N: "nonce-bob"}, f.Secret)

	dial := func(ticket string) *websocket.Conn {
		conn, _, err := websocket.Dial(ctx, socketURL(srv, "0", ticket), nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		return conn
	}
	read := func(conn *websocket.Conn) map[string]any {
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var m map[string]any
		_ = json.Unmarshal(data, &m)
		return m
	}
	ada, bob := dial(f.Valid), dial(bobTicket)
	for _, c := range []*websocket.Conn{ada, bob} {
		if m := read(c); m["type"] != "joined" {
			t.Fatalf("got %v", m)
		}
	}
	for _, c := range []*websocket.Conn{ada, bob} {
		r := read(c)
		if r["type"] != "round" || r["n"] != float64(1) {
			t.Fatalf("got %v", r)
		}
		if _, leaked := r["correct"]; leaked {
			t.Fatal("the round carried its key")
		}
	}
	answer := func(c *websocket.Conn, choice int) {
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"type":"answer","n":1,"choice":`+strconv.Itoa(choice)+`}`))
	}
	_ = ada.Write(ctx, websocket.MessageText, []byte(`not json`)) // dropped, socket stays
	answer(ada, 0)
	answer(bob, 3)
	reveal := read(ada)
	if reveal["type"] != "reveal" || reveal["correct"] != float64(0) {
		t.Fatalf("reveal: %v", reveal)
	}
	pts := reveal["points"].(map[string]any)
	if pts["user-1"].(float64) < 100 || pts["user-2"] != float64(0) {
		t.Fatalf("points: %v", pts)
	}
}

func TestAnUnknownMatchClosesTheSocket(t *testing.T) {
	f := loadFixtures(t)
	sockets := newMatchSockets()
	cfg := config{serverID: f.Server, ticketSecret: []byte(f.Secret)}
	srv := httptest.NewServer(newHandler(cfg, sockets, newRegistry(newMemStore(map[string]matchDef{}), realClock{}, slog.New(slog.DiscardHandler)), func() time.Time { return time.Unix(f.Now, 0) }))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, socketURL(srv, "0", f.Valid), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := conn.Read(ctx); websocket.CloseStatus(err) != websocket.StatusInternalError {
		t.Fatalf("got %v, want an internal error close", err)
	}
}
