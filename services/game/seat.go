package main

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// A player's socket as the actor's seat: messages queue to a writer goroutine, so a
// slow player never holds up the match (the actor drops a seat whose queue is full).
type wsSeat struct {
	conn   *websocket.Conn
	out    chan []byte
	done   chan struct{}
	once   sync.Once
	reason string
}

func newWSSeat(conn *websocket.Conn) *wsSeat {
	return &wsSeat{conn: conn, out: make(chan []byte, 32), done: make(chan struct{})}
}

func (s *wsSeat) send(msg any) bool {
	raw, err := json.Marshal(msg)
	if err != nil {
		return false
	}
	select {
	case s.out <- raw:
		return true
	default:
		return false
	}
}

func (s *wsSeat) close(reason string) {
	s.once.Do(func() {
		s.reason = reason
		close(s.done)
	})
}

// Writes until closed, then sends what is still queued (a final result before "match
// over") and closes the socket: normally at the end of a match, "going away" otherwise.
func (s *wsSeat) writeLoop(ctx context.Context) {
	write := func(raw []byte) bool {
		w, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return s.conn.Write(w, websocket.MessageText, raw) == nil
	}
	for {
		select {
		case raw := <-s.out:
			if !write(raw) {
				s.close("write failed")
			}
		case <-s.done:
			for {
				select {
				case raw := <-s.out:
					write(raw)
					continue
				default:
				}
				break
			}
			_ = s.conn.Close(closeStatus(s.reason), s.reason)
			return
		case <-ctx.Done():
			return
		}
	}
}

// A finished or cancelled match ends normally; a socket that isn't a player's breaks the
// rules; anything else (shutdown, a fault, a slow player) is going away, so the client
// may try again (P3-W15-S04).
func closeStatus(reason string) websocket.StatusCode {
	switch reason {
	case "match over", "match cancelled":
		return websocket.StatusNormalClosure
	case "not a player of this match":
		return websocket.StatusPolicyViolation
	default:
		return websocket.StatusGoingAway
	}
}
