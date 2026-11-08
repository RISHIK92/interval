package main

import (
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"sync"
	"time"
)

// Q-P3-22 (owner, 2026-11-02): 7 rounds of 15 seconds, the same question to both.
// Q-P3-24 (owner, 2026-11-03): fastest finger. One answer each a round; the first right
// answer takes it and ends it; most rounds taken wins.
const (
	roundTime   = 15 * time.Second
	revealPause = 3 * time.Second  // the right answer stays up before the next round
	joinWait    = 60 * time.Second // every player must have joined (or rejoined after a restart) by then
	grace       = 10 * time.Second // MATCH-6: a dropped player's time to come back
)

// P3-W15-S04 (LOAD-2): where a match stands after a round, saved so a restarted server
// plays on from there (game:snap:<id>). Over: it has ended; never play it again.
type snap struct {
	Next    int                         `json:"next"` // the round to play, from 1
	Totals  map[string]int              `json:"totals"`
	Times   map[string]time.Duration    `json:"times"`
	Answers map[string][]answerRec      `json:"answers"` // so a restart's result has them all
	Signals map[string][]fairPlaySignal `json:"signals"` // P3-W18-S02: likewise
	Over    bool                        `json:"over"`
}

// P3-W15-S05: a player's answer to a round, for the result (null fields: not answered).
type answerRec struct {
	Round      int    `json:"round"`
	QuestionID int64  `json:"question_id"`
	Choice     *int   `json:"choice"`
	Correct    *bool  `json:"correct"`
	Ms         *int64 `json:"ms"`
}

// A match as the web app handed it over (game:match:<id> in Valkey): its players and
// its rounds, keys included. Keys never leave this process before a round ends.
type matchDef struct {
	Players []string  `json:"players"`
	Mode    string    `json:"mode"` // sprintMode, or rounds ("fastest_finger" or none)
	Rounds  []round   `json:"rounds"`
	Ghost   *ghostDef `json:"ghost,omitempty"` // P3-W17-S01: the other seat replays a run
}

// P3-W17-S01 (BOT-1, BOT-3): a recorded run replayed as a player. It is one of
// Players, always seated, and its label is shown to the human (never its owner's name).
type ghostDef struct {
	Player  string        `json:"player"`
	Label   string        `json:"label"`
	Answers []ghostAnswer `json:"answers"`
}

// An answer to round (or sprint question) N, Ms after it began on the server's clock.
type ghostAnswer struct {
	N      int   `json:"n"`
	Choice int   `json:"choice"`
	Ms     int64 `json:"ms"`
}

type round struct {
	Question int64    `json:"question"`
	Stem     string   `json:"stem"`
	Options  []string `json:"options"`
	Correct  int      `json:"correct"`
	AI       bool     `json:"ai"` // ADR-0037: model-drafted, shown as such
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
	kind   string // join, leave, answer, focus, rtt, graceOver, sync
	player string
	seat   seat
	n      int // the round answered; for graceOver, the leave's generation
	choice int
	rtt    time.Duration
	at     time.Time // when an answer arrived
	done   chan struct{}
}

// LOAD-2: one actor owns a match. Its state lives in run's goroutine only; everything
// else talks to it through events.
type actor struct {
	id      string
	def     matchDef
	clock   clock
	log     *slog.Logger
	events  chan event
	quit    chan struct{}
	ended   chan struct{}
	mu      sync.Mutex
	over    bool         // set before ended closes: posts after it are refused
	from    *snap        // a restart's starting point, when there is one
	save    func(snap)   // after each round and at the end; nil saves nothing
	publish func(result) // the result, for the worker (P3-W15-S05); nil hands nothing
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

// P3-W18-S02: the player's page lost focus (another tab or window), as it arrived.
func (a *actor) focus(player string) {
	a.post(event{kind: "focus", player: player, at: a.clock.Now()})
}

func (a *actor) rtt(player string, d time.Duration) {
	a.post(event{kind: "rtt", player: player, rtt: d})
}

// The player's socket ended; it has `grace` to come back on a new one.
func (a *actor) leave(player string, s seat) {
	a.post(event{kind: "leave", player: player, seat: s})
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
	seats     map[string]seat
	rtts      map[string]time.Duration
	totals    map[string]int
	times     map[string]time.Duration
	started   bool
	gens      map[string]int // a player's joins and leaves, so a stale grace is ignored
	abandoned []string
	before    map[string]int // totals as the current round began: what a rejoiner is shown
	shown     int            // the last round revealed
	reveal    map[string]any // its reveal, for a player who missed it
	answers   map[string][]answerRec
	signals   map[string][]fairPlaySignal // P3-W18-S02: fair-play signals, per player
	sprint    *sprintRun                  // a sprint's own state, once it has begun
	countdown time.Time                   // when the countdown before the first question ends; zero: none running
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
		seats:   map[string]seat{},
		rtts:    map[string]time.Duration{},
		totals:  map[string]int{},
		times:   map[string]time.Duration{},
		gens:    map[string]int{},
		answers: map[string][]answerRec{},
		signals: map[string][]fairPlaySignal{},
	}
	defer func() {
		// No panic leaves the match: it ends, logged, and its players are let go.
		if r := recover(); r != nil {
			a.log.Error("game: match failed", "panic", fmt.Sprint(r))
			p.closeAll("match failed")
		}
	}()
	first := 1
	for _, player := range a.def.Players {
		p.totals[player] = 0
	}
	if a.from != nil {
		// A restart (owner, 2026-11-02): the round that was being played is played again
		// from its start, its earlier answers gone.
		first = a.from.Next
		for player, total := range a.from.Totals {
			p.totals[player] = total
		}
		for player, took := range a.from.Times {
			p.times[player] = took
		}
		for player, given := range a.from.Answers {
			p.answers[player] = given
		}
		for player, raised := range a.from.Signals {
			p.signals[player] = raised
		}
	}

	if g := a.def.Ghost; g != nil {
		p.seats[g.Player] = ghostSeat{} // never joins, never leaves
	}
	// Waiting for every player (again, after a restart).
	deadline := a.clock.After(joinWait)
	for len(p.seats) < len(a.def.Players) {
		select {
		case e := <-a.events:
			a.handle(&p, e, nil)
		case <-deadline:
			if a.from != nil {
				// After a restart (owner, 2026-11-02): whoever isn't back abandons, and
				// the one back wins; nobody back leaves the match void.
				// A ghost is always seated: no person back is nobody back.
				if len(p.seats) == 0 || (a.def.Ghost != nil && len(p.seats) == 1) {
					a.hand(&p, "void", "")
					a.persist(snap{Over: true})
					return
				}
				for _, player := range a.def.Players {
					if _, back := p.seats[player]; !back {
						p.abandoned = append(p.abandoned, player)
					}
				}
				a.finish(&p)
				return
			}
			a.broadcast(&p, map[string]any{"type": "cancelled"})
			a.hand(&p, "cancelled", "")
			a.persist(snap{Over: true})
			p.closeAll("match cancelled")
			return
		case <-a.quit:
			p.closeAll("server shutting down")
			return
		}
	}
	p.started = true
	if a.def.Mode == sprintMode {
		a.sprint(&p)
		return
	}
	if a.from != nil {
		// Where the match stood when its server stopped.
		a.broadcast(&p, map[string]any{"type": "resume", "n": first, "totals": p.totals})
	} else if !a.countdownFirst(&p) {
		return
	}

	for i := first - 1; i < len(a.def.Rounds); i++ {
		r := a.def.Rounds[i]
		n := i + 1
		started := a.clock.Now()
		p.before = maps.Clone(p.totals)
		a.broadcast(&p, roundMessage(n, r, roundTime))
		a.ghostPlays(n, n, started)
		answered := map[string]bool{} // player → right
		end := a.clock.After(roundTime)
		cur := &current{n: n, round: r, started: started, answered: answered, rights: map[string]time.Duration{}}
		cur.order = []string{}
	collect:
		for len(answered) < len(a.def.Players) && len(cur.rights) == 0 {
			select {
			case e := <-a.events:
				a.handle(&p, e, cur)
				if len(cur.rights) > 0 {
					// A right answer is in. Others already queued may have come sooner
					// on the server's clock (MATCH-5): they count too.
					for drained := false; !drained; {
						select {
						case e := <-a.events:
							a.handle(&p, e, cur)
						default:
							drained = true
						}
					}
				}
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
			if p.decided() {
				a.finish(&p)
				return
			}
		}
		for _, player := range a.def.Players {
			if _, ok := answered[player]; !ok {
				p.answers[player] = append(p.answers[player], answerRec{Round: n, QuestionID: r.Question})
			}
		}
		// The soonest right answer takes the round; equal times go to the one read first,
		// so no seat is favoured. Only rounds taken count toward time.
		taken := ""
		for _, player := range cur.order {
			if took := cur.rights[player]; taken == "" || took < cur.rights[taken] {
				taken = player
			}
		}
		if taken != "" {
			p.totals[taken]++
			p.times[taken] += cur.rights[taken]
		}
		p.shown = n
		// With its question, so a player back during the pause can be shown it.
		p.reveal = map[string]any{
			"type": "reveal", "n": n, "stem": r.Stem, "options": r.Options, "ai": r.AI,
			"correct": r.Correct, "taken": taken, "totals": p.totals,
		}
		a.broadcast(&p, p.reveal)
		if n == len(a.def.Rounds) {
			break
		}
		// The pause runs while the snapshot saves, so a slow save doesn't lengthen it.
		pause := a.clock.After(revealPause)
		a.persist(snap{Next: n + 1, Totals: p.totals, Times: p.times, Answers: p.answers, Signals: p.signals})
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
			if p.decided() {
				a.finish(&p)
				return
			}
		}
	}
	a.finish(&p)
}

func roundMessage(n int, r round, left time.Duration) map[string]any {
	return map[string]any{"type": "round", "n": n, "stem": r.Stem, "options": r.Options, "ai": r.AI, "seconds": seconds(left)}
}

// An abandon decides the match once every other player is either here or gone too
// (owner, 2026-11-02: both gone is no winner, a loss each), so a match waits out a second
// player's grace rather than naming an absent winner.
func (p *play) decided() bool {
	if len(p.abandoned) == 0 {
		return false
	}
	for player := range p.totals {
		if _, here := p.seats[player]; !here && !slices.Contains(p.abandoned, player) {
			return false
		}
	}
	return true
}

// The result: the higher total (correct answers, or rounds taken) wins; when someone
// abandoned (Q-P3-12: an abandon is a loss), the one who stayed wins, and with all gone
// nobody does.
func (a *actor) finish(p *play) {
	won := winner(p.totals, p.times)
	if len(p.abandoned) > 0 {
		won = ""
		if len(a.def.Players)-len(p.abandoned) == 1 {
			for _, player := range a.def.Players {
				if !slices.Contains(p.abandoned, player) {
					won = player
				}
			}
		}
	}
	final := map[string]any{"type": "final", "totals": p.totals, "winner": won}
	if p.sprint != nil {
		final["review"] = a.review(p)
	}
	outcome := "finished"
	if len(p.abandoned) > 0 {
		final["abandoned"] = p.abandoned
		outcome = "abandoned"
	}
	a.broadcast(p, final)
	// The result goes to the worker before the snapshot says "over": a result lost
	// after "over" could never be sent again.
	a.hand(p, outcome, won)
	a.persist(snap{Totals: p.totals, Times: p.times, Answers: p.answers, Signals: p.signals, Over: true})
	p.closeAll("match over")
}

// The worker's message (packages/db/messages/match_finished.schema.json).
type result struct {
	MatchID    string         `json:"match_id"`
	FinishedAt string         `json:"finished_at"`
	Outcome    string         `json:"outcome"` // finished, abandoned, cancelled, void
	Winner     *string        `json:"winner"`
	Players    []playerResult `json:"players"`
}

type playerResult struct {
	PlayedAs  string           `json:"played_as"`
	Total     int              `json:"total"`
	TimeMs    int64            `json:"time_ms"`
	Abandoned bool             `json:"abandoned"`
	Answers   []answerRec      `json:"answers"`
	Signals   []fairPlaySignal `json:"signals"` // P3-W18-S02: never null
}

func (a *actor) hand(p *play, outcome, won string) {
	if a.publish == nil {
		return
	}
	r := result{MatchID: a.id, FinishedAt: a.clock.Now().UTC().Format(time.RFC3339), Outcome: outcome}
	if won != "" {
		r.Winner = &won
	}
	for _, player := range a.def.Players {
		given := p.answers[player]
		if given == nil {
			given = []answerRec{}
		}
		raised := p.signals[player]
		if raised == nil {
			raised = []fairPlaySignal{}
		}
		r.Players = append(r.Players, playerResult{
			PlayedAs:  player,
			Total:     p.totals[player],
			TimeMs:    p.times[player].Milliseconds(),
			Abandoned: slices.Contains(p.abandoned, player),
			Answers:   given,
			Signals:   raised,
		})
	}
	a.publish(r)
}

func (a *actor) persist(s snap) {
	if a.save != nil {
		a.save(s)
	}
}

// The round being played, when one is.
type current struct {
	n        int
	round    round
	started  time.Time
	answered map[string]bool          // each player's one answer: right or not
	rights   map[string]time.Duration // the right ones, compensated: the soonest takes the round
	order    []string                 // the right ones, as read
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
		p.gens[e.player]++ // any grace running for this player is now stale
		if !p.countdown.IsZero() {
			left := max(0, p.countdown.Sub(a.clock.Now()))
			e.seat.send(map[string]any{"type": "countdown", "seconds": seconds(left)})
		} else if p.sprint != nil {
			a.sprintResume(p, e.player, e.seat)
		} else if p.started {
			// Back within the grace: where the match stands, and what it missed. Totals
			// are as the round began, so a rejoin can't tell how the other answered.
			if cur != nil {
				_, done := cur.answered[e.player]
				// Who has locked in, as the locked broadcasts told (never whether right).
				locked := []string{}
				for _, player := range a.def.Players {
					if _, in := cur.answered[player]; in {
						locked = append(locked, player)
					}
				}
				e.seat.send(map[string]any{"type": "resume", "n": cur.n, "totals": p.before, "answered": done, "locked": locked})
				// The round too, answered or not, so the screen shows its question.
				left := roundTime - a.clock.Now().Sub(cur.started)
				e.seat.send(roundMessage(cur.n, cur.round, max(0, left)))
			} else {
				e.seat.send(map[string]any{"type": "resume", "n": p.shown, "totals": p.totals})
				if p.reveal != nil {
					e.seat.send(p.reveal)
				}
			}
		}
	case "leave":
		if p.seats[e.player] != e.seat {
			return // an old socket of a player already back on a new one
		}
		delete(p.seats, e.player)
		if !p.started {
			return
		}
		p.gens[e.player]++
		gen, player := p.gens[e.player], e.player
		// The timer is set here, in the actor, so the grace starts at the leave.
		lapse := a.clock.After(grace)
		go func() {
			select {
			case <-lapse:
				a.post(event{kind: "graceOver", player: player, n: gen})
			case <-a.ended:
			}
		}()
	case "graceOver":
		if p.gens[e.player] != e.n {
			return // back since, or left again: a later grace decides
		}
		if !slices.Contains(p.abandoned, e.player) {
			p.abandoned = append(p.abandoned, e.player)
		}
	case "rtt":
		p.rtts[e.player] = e.rtt
	case "focus":
		// Only while a question is live: a fastest-finger round being played, or a
		// sprint's player's current question.
		if s := p.sprint; s != nil {
			if s.live && !s.over && s.at[e.player] < len(a.def.Rounds) {
				a.raise(p, e.player, fairPlaySignal{Kind: "focus", Round: s.at[e.player] + 1})
			}
		} else if cur != nil && e.at.Sub(cur.started) <= roundTime {
			// Judged by its stamp, as answers are: one drained after the round's
			// time isn't in it.
			a.raise(p, e.player, fairPlaySignal{Kind: "focus", Round: cur.n})
		}
	case "answer":
		if p.sprint != nil {
			a.sprintAnswer(p, e)
			return
		}
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
		right := e.choice == cur.round.Correct
		choice, ms := e.choice, took.Milliseconds()
		p.answers[e.player] = append(p.answers[e.player], answerRec{
			Round: cur.n, QuestionID: cur.round.Question, Choice: &choice, Correct: &right, Ms: &ms,
		})
		cur.answered[e.player] = right
		a.speed(p, e.player, cur.n, took)
		if right {
			cur.rights[e.player] = took
			cur.order = append(cur.order, e.player)
		}
		// The opponent sees that, not whether (wireframe 12).
		a.broadcast(p, map[string]any{"type": "locked", "player": e.player})
	}
}

func (a *actor) broadcast(p *play, msg any) {
	for player, s := range p.seats {
		if !s.send(msg) {
			// Too slow to keep up: dropped as if it had left, with the same grace.
			s.close("too slow")
			a.handle(p, event{kind: "leave", player: player, seat: s}, nil)
		}
	}
}

func (p *play) closeAll(reason string) {
	for _, s := range p.seats {
		s.close(reason)
	}
}
