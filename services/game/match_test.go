package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"testing"
	"time"
)

// P3-W15-S03 (LOAD-2, MATCH-5, Q-P3-22): one actor plays a match's rounds on its own
// clock, never sends a key before the round ends, and takes each player's first answer.

type fakeClock struct {
	mu      sync.Mutex
	now     time.Time
	waiters []fakeWaiter
}

type fakeWaiter struct {
	at time.Time
	ch chan time.Time
}

func newFakeClock() *fakeClock { return &fakeClock{now: time.Unix(1_800_000_000, 0)} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) After(d time.Duration) <-chan time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch := make(chan time.Time, 1)
	c.waiters = append(c.waiters, fakeWaiter{c.now.Add(d), ch})
	return ch
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	var due []fakeWaiter
	kept := c.waiters[:0]
	for _, w := range c.waiters {
		if !w.at.After(c.now) {
			due = append(due, w)
		} else {
			kept = append(kept, w)
		}
	}
	c.waiters = kept
	now := c.now
	c.mu.Unlock()
	for _, w := range due {
		w.ch <- now
	}
}

// What a player was sent, decoded.
type fakeSeat struct {
	out    chan map[string]any
	closed chan string
	slow   bool // its queue is full: every send fails
}

func newFakeSeat() *fakeSeat {
	return &fakeSeat{out: make(chan map[string]any, 64), closed: make(chan string, 1)}
}

func (s *fakeSeat) send(msg any) bool {
	if s.slow {
		return false
	}
	raw, _ := json.Marshal(msg)
	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	s.out <- decoded
	return true
}

func (s *fakeSeat) close(reason string) { s.closed <- reason }

func (s *fakeSeat) next(t *testing.T) map[string]any {
	t.Helper()
	select {
	case m := <-s.out:
		return m
	case <-time.After(2 * time.Second):
		t.Fatal("nothing sent")
		return nil
	}
}

func sevenRounds() matchDef {
	def := matchDef{Players: []string{"ada", "bob"}}
	for i := range 7 {
		def.Rounds = append(def.Rounds, round{
			Question: int64(100 + i),
			Stem:     "Which?",
			Options:  []string{"w", "x", "y", "z"},
			Correct:  i % 4,
		})
	}
	return def
}

func startActor(t *testing.T, def matchDef) (*actor, *fakeClock, *fakeSeat, *fakeSeat) {
	t.Helper()
	clock := newFakeClock()
	a := newActor("m1", def, clock, nil)
	go a.run()
	t.Cleanup(a.stop)
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	if def.Mode != sprintMode {
		passCountdown(t, a, clock, ada, bob)
	}
	return a, clock, ada, bob
}

// Plays the 3 s before round 1 (P3-W16-S05); the next message is round 1.
func passCountdown(t *testing.T, a *actor, clock *fakeClock, seats ...*fakeSeat) {
	t.Helper()
	for _, s := range seats {
		if m := s.next(t); m["type"] != "countdown" {
			t.Fatalf("got %v", m)
		}
	}
	settle(a)
	clock.Advance(countdownTime)
	settle(a)
}

// Waits until the actor has taken every event sent so far, so the clock can move on.
func settle(a *actor) { a.sync() }

func TestAFullMatch(t *testing.T) {
	a, clock, ada, bob := startActor(t, sevenRounds())
	for n := 1; n <= 7; n++ {
		r := ada.next(t)
		if r["type"] != "round" || r["n"] != float64(n) {
			t.Fatalf("round %d: got %v", n, r)
		}
		if _, leaked := r["correct"]; leaked {
			t.Fatalf("round %d sent its key: %v", n, r)
		}
		if bob.next(t)["type"] != "round" {
			t.Fatal("bob got no round")
		}
		correct := (n - 1) % 4
		// Ada answers right after 3 s with a 100 ms round trip; Bob wrong.
		a.rtt("ada", 100*time.Millisecond)
		clock.Advance(3 * time.Second)
		a.answer("ada", n, correct)
		a.answer("bob", n, (correct+1)%4)
		settle(a)
		reveal := until(t, ada, "reveal")
		if reveal["correct"] != float64(correct) || reveal["taken"] != "ada" {
			t.Fatalf("reveal %d: %v", n, reveal)
		}
		until(t, bob, "reveal")
		settle(a) // the pause's timer is set once the reveal is out
		clock.Advance(revealPause)
		settle(a)
	}
	final := ada.next(t)
	if final["type"] != "final" || final["winner"] != "ada" {
		t.Fatalf("final: %v", final)
	}
	if totals := final["totals"].(map[string]any); totals["ada"] != float64(7) || totals["bob"] != float64(0) {
		t.Fatalf("totals: %v", totals)
	}
	bob.next(t)
	if reason := <-ada.closed; reason != "match over" {
		t.Fatalf("closed with %q", reason)
	}
}

func TestOnlyAPlayersRealFirstAnswerToThisRoundCounts(t *testing.T) {
	a, _, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.answer("ada", 2, 1) // another round: ignored
	a.answer("ada", 1, 9) // no such choice: ignored
	a.answer("eve", 1, 0) // not a player: ignored
	settle(a)
	select {
	case m := <-ada.out:
		t.Fatalf("an ignored answer did something: %v", m)
	default:
	}
	a.answer("ada", 1, 0) // right (round 1's key is 0): taken
	settle(a)
	if reveal := until(t, ada, "reveal"); reveal["taken"] != "ada" {
		t.Fatalf("got %v", reveal)
	}
}

func TestAMatchNobodyCompletesIsCancelled(t *testing.T) {
	clock := newFakeClock()
	a := newActor("m2", sevenRounds(), clock, nil)
	go a.run()
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	settle(a)
	clock.Advance(joinWait)
	settle(a)
	if m := ada.next(t); m["type"] != "cancelled" {
		t.Fatalf("got %v", m)
	}
	if reason := <-ada.closed; reason != "match cancelled" {
		t.Fatalf("closed with %q", reason)
	}
}

func TestAnAnswerAfterTheRoundsTimeTakesNothing(t *testing.T) {
	a, clock, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	// Stamped after the 15 s (and more than the compensation) though handled before the
	// round's timer: refused.
	a.answerAt("ada", 1, 0, clock.Now().Add(roundTime+maxCompensation+time.Millisecond))
	settle(a)
	clock.Advance(roundTime)
	settle(a)
	if reveal := ada.next(t); reveal["taken"] != "" {
		t.Fatalf("got %v", reveal)
	}
}

func TestAPlayerTooSlowToKeepUpIsDropped(t *testing.T) {
	clock := newFakeClock()
	a := newActor("m3", sevenRounds(), clock, nil)
	go a.run()
	t.Cleanup(a.stop)
	ada, bob := newFakeSeat(), newFakeSeat()
	bob.slow = true
	a.join("ada", ada)
	a.join("bob", bob)
	if ada.next(t)["type"] != "countdown" {
		t.Fatal("no countdown")
	}
	if reason := <-bob.closed; reason != "too slow" {
		t.Fatalf("closed with %q", reason)
	}
}

func TestStoppingMidMatchLetsThePlayersGo(t *testing.T) {
	a, _, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.stop()
	for _, s := range []*fakeSeat{ada, bob} {
		if reason := <-s.closed; reason != "server shutting down" {
			t.Fatalf("closed with %q", reason)
		}
	}
	// Ended: nothing more is taken.
	if a.join("ada", newFakeSeat()) {
		t.Fatal("an ended match took a join")
	}
}

func TestAnEndedMatchCannotBeStartedAgain(t *testing.T) {
	def := sevenRounds()
	clock := newFakeClock()
	g := newRegistry(newMemStore(map[string]matchDef{"m4": def}), clock, slog.New(slog.DiscardHandler))
	first, err := g.get(context.Background(), "m4")
	if err != nil {
		t.Fatal(err)
	}
	first.stop()
	deadline := time.Now().Add(2 * time.Second)
	for {
		_, err := g.get(context.Background(), "m4")
		if errors.Is(err, errMatchOver) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the ended match was handed out again: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	// An hour on, the web app's definition is gone too; the ending is forgotten.
	clock.Advance(endedFor + time.Second)
	if _, err := g.get(context.Background(), "nope"); !errors.Is(err, errNoMatch) {
		t.Fatalf("got %v", err)
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.ended) != 0 {
		t.Fatalf("%d endings kept past the hour", len(g.ended))
	}
}

func TestParseMatchRefusesWhatCannotBePlayed(t *testing.T) {
	good := `{"players":["a","b"],"rounds":[{"question":1,"stem":"?","options":["x","y","z","w"],"correct":2}]}`
	if def, err := parseMatch([]byte(good)); err != nil || def.Rounds[0].Correct != 2 {
		t.Fatalf("good: %v %v", def, err)
	}
	for name, raw := range map[string]string{
		"not json":         `{`,
		"no rounds":        `{"players":["a","b"],"rounds":[]}`,
		"no players":       `{"players":[],"rounds":[{"options":["x","y"],"correct":0}]}`,
		"a player twice":   `{"players":["a","a"],"rounds":[{"options":["x","y"],"correct":0}]}`,
		"an empty player":  `{"players":["a",""],"rounds":[{"options":["x","y"],"correct":0}]}`,
		"key out of range": `{"players":["a","b"],"rounds":[{"options":["x","y"],"correct":2}]}`,
		"a negative key":   `{"players":["a","b"],"rounds":[{"options":["x","y"],"correct":-1}]}`,
		"too few options":  `{"players":["a","b"],"rounds":[{"options":["x"],"correct":0}]}`,
	} {
		if _, err := parseMatch([]byte(raw)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
