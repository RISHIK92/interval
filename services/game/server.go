package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// The open match sockets, so a shutdown can close them (http.Server.Shutdown doesn't
// wait for hijacked connections).
type matchSockets struct {
	mu      sync.Mutex
	conns   map[*websocket.Conn]struct{}
	closing bool // once closeAll has run, a socket that joins late is closed at once
}

func newMatchSockets() *matchSockets {
	return &matchSockets{conns: map[*websocket.Conn]struct{}{}}
}

// False when the server is already closing its sockets.
func (s *matchSockets) add(c *websocket.Conn) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		return false
	}
	s.conns[c] = struct{}{}
	return true
}

func (s *matchSockets) remove(c *websocket.Conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.conns, c)
}

func (s *matchSockets) closeAll() {
	s.mu.Lock()
	s.closing = true
	open := make([]*websocket.Conn, 0, len(s.conns))
	for c := range s.conns {
		open = append(open, c)
	}
	s.mu.Unlock()
	// At once: each Close waits for its player's reply (up to 5 s), so one at a time
	// would hold a shutdown for seconds per player.
	var closing sync.WaitGroup
	for _, c := range open {
		closing.Add(1)
		go func() {
			defer closing.Done()
			_ = c.Close(websocket.StatusGoingAway, "server shutting down")
		}()
	}
	closing.Wait()
}

func newHandler(cfg config, sockets *matchSockets, matches *registry, now func() time.Time) http.Handler {
	used := newUsedNonces()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("{\"status\":\"ok\"}\n"))
	})
	// P3-W15-S02 (ADR-0033): a player joins a match this server owns with a ticket. Its
	// rounds come with the match actor (P3-W15-S03).
	mux.HandleFunc("GET /game/{server}/ws", func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("server") != cfg.serverID {
			http.NotFound(w, r)
			return
		}
		at := now()
		ticket, err := verify(r.URL.Query().Get("ticket"), cfg.ticketSecret, cfg.serverID, at)
		if err != nil {
			reason := "ticket refused"
			var refused *ticketError
			if errors.As(err, &refused) {
				reason = refused.Error()
			}
			http.Error(w, reason, http.StatusUnauthorized)
			return
		}
		if !used.claim(ticket.N, ticket.E, at) {
			http.Error(w, "ticket refused: used", http.StatusUnauthorized)
			return
		}
		// No origin check: the single-use ticket is the authorisation, not a cookie, so a
		// cross-site page gains nothing; and behind CloudFront the Host is the ALB's.
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return // Accept has already answered the request
		}
		if !sockets.add(conn) {
			_ = conn.Close(websocket.StatusGoingAway, "server shutting down")
			return
		}
		defer sockets.remove(conn)
		a, err := matches.get(r.Context(), ticket.M)
		if errors.Is(err, errMatchOver) {
			_ = conn.Close(websocket.StatusNormalClosure, "match over")
			return
		}
		if err != nil {
			// The web app makes the match before it issues tickets, so this is a fault.
			matches.log.Error("game: match not loaded", "match", ticket.M, "error", err.Error())
			_ = conn.Close(websocket.StatusInternalError, "match unavailable")
			return
		}
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		player := newWSSeat(conn)
		go safely(matches.log, "writer", func() { player.writeLoop(ctx) })
		defer player.close("left")
		joined := map[string]string{"type": "joined", "match": ticket.M, "you": ticket.U}
		if g := a.def.Ghost; g != nil {
			joined["opponent"] = g.Label // BOT-3: always labeled
		}
		player.send(joined)
		if !a.join(ticket.U, player) {
			player.close("match over") // it ended as this player arrived
			return
		}
		go safely(matches.log, "ping", func() {
			measure(ctx, conn, func(rtt time.Duration) { a.rtt(ticket.U, rtt) })
		})
		limit, code := int64(1024), func(*codeMsg) {}
		if a.def.Battle != nil {
			// P5-W31-S02b-2: a battle's code, JSON-escaped: up to six bytes a character.
			limit = 6*maxCodeBytes + 1024
			var last time.Time
			code = func(c *codeMsg) {
				// At most one a second from a socket, whatever the actor's cooldowns: a
				// stream of large messages would otherwise fill its queue.
				at := matches.clock.Now()
				if at.Sub(last) < time.Second {
					return
				}
				last = at
				if !a.post(event{kind: "code", player: ticket.U, code: c, at: at}) {
					matches.log.Error("game: code dropped", "match", ticket.M, "player", ticket.U)
				}
			}
		}
		readMessages(ctx, conn, limit, func(n, choice int) {
			a.answerAt(ticket.U, n, choice, matches.clock.Now())
		}, func() { a.focus(ticket.U) }, code)
		// The socket ended: the player has the grace to come back (MATCH-6).
		a.leave(ticket.U, player)
	})
	return mux
}

// MATCH-5: the round trip, by WebSocket ping, at once and then every 25 s (which also
// keeps the socket open through the ALB and CloudFront, ADR-0033).
const pingEvery = 25 * time.Second

func measure(ctx context.Context, conn *websocket.Conn, report func(time.Duration)) {
	for {
		start := time.Now()
		ping, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := conn.Ping(ping)
		cancel()
		if ctx.Err() != nil {
			return
		}
		// A ping that times out (a stalled phone) is skipped, not the end of measuring.
		if err == nil {
			report(time.Since(start))
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(pingEvery):
		}
	}
}

// A player's answers, {"type":"answer","n":round,"choice":0-3}, focus changes,
// {"type":"focus"} (P3-W18-S02), and a battle's code, {"type":"run"|"submit",...}
// (P5-W31-S02b-2). Anything else, or anything over the limit, is dropped or ends the
// socket; the actor checks the rest.
func readMessages(ctx context.Context, conn *websocket.Conn, limit int64, answer func(n, choice int), focus func(), code func(*codeMsg)) {
	conn.SetReadLimit(limit)
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		// A battle's code first: the one large message, read once.
		if limit > 1024 {
			if c := parseCode(data); c != nil {
				code(c)
				continue
			}
		}
		var msg struct {
			Type   string `json:"type"`
			N      *int   `json:"n"`
			Choice *int   `json:"choice"`
		}
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		if msg.Type == "focus" {
			focus()
			continue
		}
		if msg.Type != "answer" || msg.N == nil || msg.Choice == nil {
			continue
		}
		answer(*msg.N, *msg.Choice)
	}
}
