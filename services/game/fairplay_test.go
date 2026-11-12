package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// P3-W18-S02 (§6.9, Q-P3-20): fair-play signals in a live match. An answer under 400 ms
// after its question arrived (compensated) and a focus change during a live round are
// signals; the result carries each player's for the worker to flag. Nothing here
// penalises anyone.

func rounds(n int) matchDef {
	def := sevenRounds()
	def.Rounds = def.Rounds[:n]
	return def
}

// A rounds match of n through the registry, its countdown played; the result lands in
// the store.
func fairPlayMatch(t *testing.T, n int) (*actor, *fakeClock, *fakeSeat, *fakeSeat, *memStore) {
	t.Helper()
	store := newMemStore(map[string]matchDef{"m": rounds(n)})
	clock := newFakeClock()
	a, ada, bob := registryRounds(t, store, clock)
	return a, clock, ada, bob, store
}

func signalsOf(t *testing.T, store *memStore, player string) []fairPlaySignal {
	t.Helper()
	results := store.results()
	if len(results) != 1 {
		t.Fatalf("%d results", len(results))
	}
	for _, p := range results[0].Players {
		if p.PlayedAs == player {
			if p.Signals == nil {
				t.Fatalf("%s: signals is null, want a list", player)
			}
			return p.Signals
		}
	}
	t.Fatalf("no %s in %+v", player, results[0].Players)
	return nil
}

func TestAnAnswerUnder400msIsASpeedSignal(t *testing.T) {
	for name, tc := range map[string]struct {
		rtt, after time.Duration
		want       bool
	}{
		"300 ms":                {0, 300 * time.Millisecond, true},
		"500 ms":                {0, 500 * time.Millisecond, false},
		"exactly 400 ms":        {0, 400 * time.Millisecond, false},
		"450 ms, 200 ms of rtt": {200 * time.Millisecond, 450 * time.Millisecond, true},
	} {
		t.Run(name, func(t *testing.T) {
			a, clock, ada, bob, store := fairPlayMatch(t, 1)
			a.rtt("ada", tc.rtt)
			ada.next(t)
			bob.next(t)
			clock.Advance(tc.after)
			a.answer("ada", 1, 0)
			settle(a)
			waitEnded(t, a)
			got := signalsOf(t, store, "ada")
			if !tc.want {
				if len(got) != 0 {
					t.Fatalf("got %+v", got)
				}
				return
			}
			want := compensated(tc.after, tc.rtt).Milliseconds()
			if len(got) != 1 || got[0].Kind != "speed" || got[0].Round != 1 || got[0].Ms == nil || *got[0].Ms != want {
				t.Fatalf("got %+v", got)
			}
			if len(signalsOf(t, store, "bob")) != 0 {
				t.Fatal("bob didn't answer")
			}
		})
	}
}

func TestAFocusChangeCountsOnlyInALiveRoundAndOnceARound(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": rounds(2)})
	clock := newFakeClock()
	a, ada, bob := registryWith(t, store, clock)
	a.focus("ada") // in the countdown: not a live round
	settle(a)
	passCountdown(t, a, clock, ada, bob)
	clock.Advance(time.Second)
	a.focus("ada")
	a.focus("ada") // blur and visibilitychange of one switch
	settle(a)
	a.answer("ada", 1, 0)
	settle(a)
	until(t, ada, "reveal")
	a.focus("ada") // the reveal's pause: not live
	settle(a)
	clock.Advance(revealPause)
	settle(a)
	until(t, ada, "round")
	clock.Advance(time.Second)
	a.focus("ada")
	a.answer("ada", 2, 1)
	settle(a)
	waitEnded(t, a)
	got := signalsOf(t, store, "ada")
	if len(got) != 2 || got[0] != (fairPlaySignal{Kind: "focus", Round: 1}) || got[1] != (fairPlaySignal{Kind: "focus", Round: 2}) {
		t.Fatalf("got %+v", got)
	}
}

// A sprint's question arrives when the player answered the one before, so its time is
// counted from then, not from the sprint's start.
func TestASprintAnswerIsTimedFromItsOwnQuestion(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sprintDef(2)})
	clock := newFakeClock()
	a, ada, bob := registryWith(t, store, clock)
	passCountdown(t, a, clock, ada, bob)
	clock.Advance(time.Second)
	a.answer("ada", 1, 0) // 1 s: none
	a.answer("bob", 1, 0)
	settle(a)
	clock.Advance(200 * time.Millisecond)
	a.answer("ada", 2, 1) // 200 ms after question 2 arrived
	settle(a)
	clock.Advance(time.Second)
	a.answer("bob", 2, 1) // 1.2 s after: none
	settle(a)
	waitEnded(t, a)
	got := signalsOf(t, store, "ada")
	if len(got) != 1 || got[0].Kind != "speed" || got[0].Round != 2 || *got[0].Ms != 200 {
		t.Fatalf("ada: %+v", got)
	}
	if b := signalsOf(t, store, "bob"); len(b) != 0 {
		t.Fatalf("bob: %+v", b)
	}
}

func TestASprintFocusCountsOnceAQuestion(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sprintDef(2)})
	clock := newFakeClock()
	a, ada, bob := registryWith(t, store, clock)
	passCountdown(t, a, clock, ada, bob)
	clock.Advance(time.Second)
	a.focus("ada")
	a.focus("ada")
	a.answer("ada", 1, 0)
	settle(a)
	a.focus("ada")
	for _, player := range []string{"ada", "bob"} {
		for n := 1; n <= 2; n++ {
			a.answer(player, n, n-1)
		}
	}
	settle(a)
	waitEnded(t, a)
	var got []fairPlaySignal // question 2's instant answer is a speed signal too
	for _, raised := range signalsOf(t, store, "ada") {
		if raised.Kind == "focus" {
			got = append(got, raised)
		}
	}
	if len(got) != 2 || got[0] != (fairPlaySignal{Kind: "focus", Round: 1}) || got[1] != (fairPlaySignal{Kind: "focus", Round: 2}) {
		t.Fatalf("got %+v", got)
	}
}

func TestAGhostHasNoSignals(t *testing.T) {
	def := withGhost(rounds(1), ghostAnswer{N: 1, Choice: 0, Ms: 100})
	store := newMemStore(map[string]matchDef{"m": def})
	clock := newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	a, err := g.get(context.Background(), "m")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	passCountdown(t, a, clock, ada)
	clock.Advance(100 * time.Millisecond)
	settle(a)
	settle(a)
	waitEnded(t, a)
	if got := signalsOf(t, store, "ghost:7"); len(got) != 0 {
		t.Fatalf("got %+v", got)
	}
}

// Saved with the snapshot, so a restart's result still has the earlier rounds'.
func TestSignalsSurviveARestart(t *testing.T) {
	a, clock, ada, bob, store := fairPlayMatch(t, 2)
	ada.next(t)
	bob.next(t)
	clock.Advance(100 * time.Millisecond)
	a.answer("ada", 1, 0)
	settle(a)
	until(t, ada, "reveal")
	settle(a)
	saved, ok, _ := store.snapshot(context.Background(), "m")
	if !ok || len(saved.Signals["ada"]) != 1 {
		t.Fatalf("snapshot: %+v", saved)
	}
	a.stop()
	waitEnded(t, a)

	clock2 := newFakeClock()
	again := newMemStore(map[string]matchDef{"m": rounds(2)})
	_ = again.save(context.Background(), "m", saved)
	b, ada2, bob2 := registryWith(t, again, clock2)
	until(t, ada2, "round")
	until(t, bob2, "round")
	b.answer("ada", 2, 1)
	settle(b)
	waitEnded(t, b)
	got := signalsOf(t, again, "ada")
	if len(got) != 2 || got[0].Round != 1 || got[1].Round != 2 {
		t.Fatalf("got %+v", got)
	}
}

// The socket passes {"type":"focus"} on; anything else that isn't an answer is dropped.
func TestTheSocketPassesFocusOn(t *testing.T) {
	focused := make(chan struct{}, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		readMessages(r.Context(), conn, 1024, func(int, int) {}, func() { focused <- struct{}{} }, func(*codeMsg) {})
	}))
	t.Cleanup(srv.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	for _, msg := range []any{map[string]string{"type": "focus"}, map[string]string{"type": "other"}} {
		raw, _ := json.Marshal(msg)
		_ = conn.Write(ctx, websocket.MessageText, raw)
	}
	select {
	case <-focused:
	case <-ctx.Done():
		t.Fatal("focus not passed on")
	}
	select {
	case <-focused:
		t.Fatal("other passed on as focus")
	case <-time.After(100 * time.Millisecond):
	}
}

// ADR-0037 (AI-3): a model-drafted question says so in its round and question messages.
func TestAnAIDraftedQuestionSaysSo(t *testing.T) {
	def := rounds(2)
	def.Rounds[0].AI = true
	a, _, ada, bob := startActor(t, def)
	if r := ada.next(t); r["type"] != "round" || r["ai"] != true {
		t.Fatalf("round 1: %v", r)
	}
	bob.next(t)
	a.answer("ada", 1, 0)
	settle(a)
	if m := until(t, ada, "reveal"); m["ai"] != true {
		t.Fatalf("reveal: %v", m)
	}
}

func TestASprintQuestionCarriesItsAIFlag(t *testing.T) {
	def := sprintDef(2)
	def.Rounds[1].AI = true
	a := newActor("m", def, newFakeClock(), nil)
	p := &play{sprint: &sprintRun{at: map[string]int{"ada": 0}}}
	if m := a.nextFor(p, "ada"); m["ai"] != false {
		t.Fatalf("question 1: %v", m)
	}
	p.sprint.at["ada"] = 1
	if m := a.nextFor(p, "ada"); m["ai"] != true {
		t.Fatalf("question 2: %v", m)
	}
}
