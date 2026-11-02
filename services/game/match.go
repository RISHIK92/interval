package main

import (
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"
)

// Q-P3-22 (owner, 2026-11-02): 7 rounds of 15 seconds, the same question to both.
const (
	roundTime   = 15 * time.Second
	revealPause = 3 * time.Second  // the right answer stays up before the next round
	joinWait    = 60 * time.Second // every player must have joined by then
)

// A match as the web app handed it over (game:match:<id> in Valkey): its players and
// its rounds, keys included. Keys never leave this process before a round ends.
type matchDef struct {
	Players []string `json:"players"`
	Rounds  []round  `json:"rounds"`
}

type round struct {
	Question int64    `json:"question"`
	Stem     string   `json:"stem"`
	Options  []string `json:"options"`
	Correct  int      `json:"correct"`
}

// One player's connection, as the actor sees it: messages out, and a way to end it.
type seat interface {
	send(msg any) bool
	close(reason string)
}

type clock interface {
	Now() time.Time
	After(d time.Duration) <-chan time.Time
}

type realClock struct{}

func (realClock) Now() time.Time                         { return time.Now() }
func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }

type event struct {
	kind   string // join, answer, rtt, sync
	player string
	seat   seat
	n      int
	choice int
	rtt    time.Duration
	at     time.Time // when an answer arrived
	done   chan struct{}
}

// LOAD-2: one actor owns a match. Its state lives in run's goroutine only; everything
// else talks to it through events.
type actor struct {
	id     string
	def    matchDef
	clock  clock
	log    *slog.Logger
	events chan event
	quit   chan struct{}
	ended  chan struct{}
	mu     sync.Mutex
	over   bool // set before ended closes: posts after it are refused
}

func newActor(id string, def matchDef, c clock, log *slog.Logger) *actor {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &actor{
		id: id, def: def, clock: c, log: log.With("match", id),
		events: make(chan event, 256),
		quit:   make(chan struct{}),
		ended:  make(chan struct{}),
	}
}

// False once the match has ended, or when its queue is full (an actor that far behind
// is stuck): nothing will take the event.
func (a *actor) post(e event) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.over {
		return false
	}
	select {
	case a.events <- e:
		return true
	default:
		return false
	}
}

func (a *actor) join(player string, s seat) bool {
	return a.post(event{kind: "join", player: player, seat: s})
}

// An answer as it arrived: `at` is its arrival on this server, not when the actor gets to
// it, so time spent queued never counts against the player.
func (a *actor) answerAt(player string, n, choice int, at time.Time) {
	a.post(event{kind: "answer", player: player, n: n, choice: choice, at: at})
}

func (a *actor) answer(player string, n, choice int) {
	a.answerAt(player, n, choice, a.clock.Now())
}
func (a *actor) rtt(player string, d time.Duration) {
	a.post(event{kind: "rtt", player: player, rtt: d})
}

// Returns once the actor has handled every event posted before it.
func (a *actor) sync() {
	done := make(chan struct{})
	a.post(event{kind: "sync", done: done})
	select {
	case <-done:
	case <-a.ended:
	}
}

func (a *actor) stop() {
	select {
	case <-a.quit:
	default:
		close(a.quit)
	}
	<-a.ended
}

// The match's state, owned by run.
type play struct {
	seats  map[string]seat
	rtts   map[string]time.Duration
	totals map[string]int
	times  map[string]time.Duration
}

func (a *actor) run() {
	defer func() {
		// Refuse new events, then let go of any queued: a join that raced the end is
		// closed rather than left waiting, and a sync returns.
		a.mu.Lock()
		a.over = true
		a.mu.Unlock()
		for drained := false; !drained; {
			select {
			case e := <-a.events:
				switch e.kind {
				case "join":
					e.seat.close("match over")
				case "sync":
					close(e.done)
				}
			default:
				drained = true
			}
		}
		close(a.ended)
	}()
	p := play{
		seats:  map[string]seat{},
		rtts:   map[string]time.Duration{},
		totals: map[string]int{},
		times:  map[string]time.Duration{},
	}
	defer func() {
		// No panic leaves the match: it ends, logged, and its players are let go.
		if r := recover(); r != nil {
			a.log.Error("game: match failed", "panic", fmt.Sprint(r))
			p.closeAll("match failed")
		}
	}()
	for _, player := range a.def.Players {
		p.totals[player] = 0
	}

	// Waiting for every player.
	deadline := a.clock.After(joinWait)
	for len(p.seats) < len(a.def.Players) {
		select {
		case e := <-a.events:
			a.handle(&p, e, nil)
		case <-deadline:
			p.broadcast(map[string]any{"type": "cancelled"})
			p.closeAll("match cancelled")
			return
		case <-a.quit:
			p.closeAll("server shutting down")
			return
		}
	}

	for i, r := range a.def.Rounds {
		n := i + 1
		started := a.clock.Now()
		p.broadcast(map[string]any{"type": "round", "n": n, "stem": r.Stem, "options": r.Options, "seconds": int(roundTime / time.Second)})
		answered := map[string]int{} // player → points this round
		end := a.clock.After(roundTime)
		cur := &current{n: n, round: r, started: started, answered: answered}
	collect:
		for len(answered) < len(a.def.Players) {
			select {
			case e := <-a.events:
				a.handle(&p, e, cur)
			case <-end:
				// Answers already queued arrived in time or not by their own stamp.
				for drained := false; !drained; {
					select {
					case e := <-a.events:
						a.handle(&p, e, cur)
					default:
						drained = true
					}
				}
				break collect
			case <-a.quit:
				p.closeAll("server shutting down")
				return
			}
		}
		for _, player := range a.def.Players {
			if _, ok := answered[player]; !ok {
				answered[player] = 0
				p.times[player] += roundTime
			}
		}
		p.broadcast(map[string]any{"type": "reveal", "n": n, "correct": r.Correct, "points": answered})
		if n < len(a.def.Rounds) {
			pause := a.clock.After(revealPause)
		wait:
			for {
				select {
				case e := <-a.events:
					a.handle(&p, e, nil)
				case <-pause:
					break wait
				case <-a.quit:
					p.closeAll("server shutting down")
					return
				}
			}
		}
	}
	p.broadcast(map[string]any{"type": "final", "totals": p.totals, "winner": winner(p.totals, p.times)})
	p.closeAll("match over")
}

// The round being played, when one is.
type current struct {
	n        int
	round    round
	started  time.Time
	answered map[string]int
}

func (a *actor) handle(p *play, e event, cur *current) {
	switch e.kind {
	case "sync":
		close(e.done)
	case "join":
		if !slices.Contains(a.def.Players, e.player) {
			e.seat.close("not a player of this match")
			return
		}
		if old, ok := p.seats[e.player]; ok && old != e.seat {
			old.close("joined again elsewhere")
		}
		p.seats[e.player] = e.seat
	case "rtt":
		p.rtts[e.player] = e.rtt
	case "answer":
		// Only the round being played, a real choice, a player's first answer.
		if cur == nil || e.n != cur.n || e.choice < 0 || e.choice >= len(cur.round.Options) {
			return
		}
		if _, isPlayer := p.totals[e.player]; !isPlayer {
			return
		}
		if _, done := cur.answered[e.player]; done {
			return
		}
		took := compensated(e.at.Sub(cur.started), p.rtts[e.player])
		if took > roundTime {
			return // arrived after the round's time
		}
		got := points(e.choice == cur.round.Correct, took, roundTime)
		cur.answered[e.player] = got
		p.totals[e.player] += got
		p.times[e.player] += took
	}
}

func (p *play) broadcast(msg any) {
	for player, s := range p.seats {
		if !s.send(msg) {
			// Too slow to keep up: dropped; it rejoins in P3-W15-S04.
			s.close("too slow")
			delete(p.seats, player)
		}
	}
}

func (p *play) closeAll(reason string) {
	for _, s := range p.seats {
		s.close(reason)
	}
}
