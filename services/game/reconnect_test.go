package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// P3-W15-S04 (LOAD-2, MATCH-6, Q-P3-12; owner, 2026-11-02): a snapshot after each round,
// a restart plays on from it, a dropped player has 10 s to come back, and one who
// doesn't abandons: the match ends and the other wins.

// Plays round n with both answering right at once, then the reveal and the pause.
func playRound(t *testing.T, a *actor, clock *fakeClock, ada, bob *fakeSeat, n int) {
	t.Helper()
	if r := ada.next(t); r["type"] != "round" || r["n"] != float64(n) {
		t.Fatalf("round %d: %v", n, r)
	}
	bob.next(t)
	correct := (n - 1) % 4
	a.answer("ada", n, correct)
	a.answer("bob", n, (correct+1)%4)
	settle(a)
	ada.next(t)
	bob.next(t)
	settle(a)
	clock.Advance(revealPause)
	settle(a)
}

func TestASnapshotAfterEachRoundAndAtTheEnd(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	clock := newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	a, err := g.get(context.Background(), "m")
	if err != nil {
		t.Fatal(err)
	}
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	playRound(t, a, clock, ada, bob, 1)
	playRound(t, a, clock, ada, bob, 2)
	saved, _, _ := store.snapshot(context.Background(), "m")
	if saved.Next != 3 || saved.Totals["ada"] != 300 || saved.Over {
		t.Fatalf("after round 2: %+v", saved)
	}
	for n := 3; n <= 6; n++ {
		playRound(t, a, clock, ada, bob, n)
	}
	ada.next(t) // round 7
	bob.next(t)
	a.answer("ada", 7, 2)
	a.answer("bob", 7, 2)
	settle(a)
	ada.next(t) // reveal
	if final := ada.next(t); final["type"] != "final" {
		t.Fatalf("got %v", final)
	}
	<-ada.closed
	if saved, _, _ := store.snapshot(context.Background(), "m"); !saved.Over {
		t.Fatalf("not marked over: %+v", saved)
	}
}

func TestARestartPlaysOnFromItsSnapshot(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	_ = store.save(context.Background(), "m", snap{
		Next:   4,
		Totals: map[string]int{"ada": 450, "bob": 120},
		Times:  map[string]time.Duration{"ada": 3 * time.Second, "bob": 40 * time.Second},
	})
	clock := newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	a, err := g.get(context.Background(), "m")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.stop)
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	// Where it stood, then the interrupted round again from its start.
	if m := ada.next(t); m["type"] != "resume" || m["n"] != float64(4) || m["totals"].(map[string]any)["ada"] != float64(450) {
		t.Fatalf("got %v", m)
	}
	bob.next(t)
	r := ada.next(t)
	if r["n"] != float64(4) || r["seconds"] != float64(15) || r["options"] == nil {
		t.Fatalf("got %v", r)
	}
	bob.next(t)
	a.answer("ada", 4, 3) // round 4's key is 3
	a.answer("bob", 4, 0)
	settle(a)
	reveal := ada.next(t)
	if reveal["correct"] != float64(3) {
		t.Fatalf("reveal: %v", reveal)
	}
	saved, _, _ := store.snapshot(context.Background(), "m")
	if saved.Next != 5 || saved.Totals["ada"] != 600 || saved.Totals["bob"] != 120 {
		t.Fatalf("totals carried: %+v", saved)
	}
}

func TestAMatchOverBeforeARestartStaysOver(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	_ = store.save(context.Background(), "m", snap{Over: true})
	g := newRegistry(store, newFakeClock(), slog.New(slog.DiscardHandler))
	if _, err := g.get(context.Background(), "m"); !errors.Is(err, errMatchOver) {
		t.Fatalf("got %v", err)
	}
}

func TestADroppedPlayerComesBackWithinTheGrace(t *testing.T) {
	a, clock, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	clock.Advance(4 * time.Second)
	a.leave("bob", bob)
	settle(a)
	clock.Advance(5 * time.Second)
	back := newFakeSeat()
	a.join("bob", back)
	settle(a)
	if m := back.next(t); m["type"] != "resume" {
		t.Fatalf("got %v", m)
	}
	// The round being played, with what's left of its 15 s.
	if m := back.next(t); m["type"] != "round" || m["n"] != float64(1) || m["seconds"] != float64(6) {
		t.Fatalf("got %v", m)
	}
	// The old grace runs out, but Bob is back: nothing happens (twice: its goroutine
	// posts after the timer).
	clock.Advance(grace)
	settle(a)
	settle(a)
	a.answer("ada", 1, 0)
	a.answer("bob", 1, 0)
	settle(a)
	if m := ada.next(t); m["type"] != "reveal" {
		t.Fatalf("got %v", m)
	}
	// A leave from Bob's old socket, after he came back, changes nothing.
	a.leave("bob", bob)
	settle(a)
	clock.Advance(revealPause)
	settle(a)
	if m := back.next(t); m["type"] != "reveal" {
		t.Fatalf("got %v", m)
	}
	if m := back.next(t); m["type"] != "round" || m["n"] != float64(2) {
		t.Fatalf("got %v", m)
	}
}

func TestAPlayerWhoDoesNotComeBackAbandons(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	clock := newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	a, _ := g.get(context.Background(), "m")
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	ada.next(t)
	bob.next(t)
	a.leave("bob", bob)
	settle(a)
	clock.Advance(grace)
	settle(a)
	final := ada.next(t)
	if final["type"] != "final" || final["winner"] != "ada" {
		t.Fatalf("got %v", final)
	}
	if left := final["abandoned"].([]any); len(left) != 1 || left[0] != "bob" {
		t.Fatalf("abandoned: %v", final["abandoned"])
	}
	if reason := <-ada.closed; reason != "match over" {
		t.Fatalf("closed with %q", reason)
	}
	if saved, _, _ := store.snapshot(context.Background(), "m"); !saved.Over {
		t.Fatal("an abandoned match isn't over")
	}
}

// Owner, 2026-11-02: both gone past their graces is no winner, an abandon each; the
// match waits out the second grace rather than naming an absent winner.
func TestBothGoneIsNoWinner(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	clock := newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	a, _ := g.get(context.Background(), "m")
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	ada.next(t)
	bob.next(t)
	a.leave("ada", ada)
	settle(a)
	clock.Advance(4 * time.Second)
	a.leave("bob", bob)
	settle(a)
	// Ada's grace lapses while Bob's still runs: not decided yet.
	clock.Advance(6 * time.Second)
	settle(a)
	settle(a)
	select {
	case <-a.ended:
		t.Fatal("decided while Bob could still come back")
	default:
	}
	clock.Advance(4 * time.Second)
	settle(a)
	select {
	case <-a.ended:
	case <-time.After(2 * time.Second):
		t.Fatal("not decided with both gone")
	}
	saved, _, _ := store.snapshot(context.Background(), "m")
	if !saved.Over {
		t.Fatalf("not over: %+v", saved)
	}
}

func TestOneGoneTheOtherBackInTimeWins(t *testing.T) {
	a, clock, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.leave("ada", ada)
	a.leave("bob", bob)
	settle(a)
	back := newFakeSeat()
	a.join("ada", back)
	settle(a)
	clock.Advance(grace)
	settle(a)
	settle(a)
	var final map[string]any
	for final == nil {
		if m := back.next(t); m["type"] == "final" {
			final = m
		}
	}
	if final["winner"] != "ada" {
		t.Fatalf("got %v", final)
	}
}

func TestAnAbandonDuringTheRevealPause(t *testing.T) {
	a, clock, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.answer("ada", 1, 0)
	a.answer("bob", 1, 0)
	settle(a)
	ada.next(t) // reveal
	bob.next(t)
	a.leave("bob", bob)
	settle(a)
	clock.Advance(grace)
	settle(a)
	settle(a)
	var final map[string]any
	for final == nil {
		if m := ada.next(t); m["type"] == "final" {
			final = m
		}
	}
	if final["winner"] != "ada" {
		t.Fatalf("got %v", final)
	}
}

func TestALeaveBeforeTheStartStartsNoGrace(t *testing.T) {
	clock := newFakeClock()
	a := newActor("m", sevenRounds(), clock, nil)
	go a.run()
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	a.leave("ada", ada)
	settle(a)
	clock.Advance(grace)
	settle(a)
	// No abandon: the match is still waiting for its players.
	a.join("ada", newFakeSeat())
	bob := newFakeSeat()
	a.join("bob", bob)
	if m := bob.next(t); m["type"] != "round" {
		t.Fatalf("got %v", m)
	}
}

func TestATooSlowPlayerGetsTheGraceToo(t *testing.T) {
	clock := newFakeClock()
	a := newActor("m", sevenRounds(), clock, nil)
	go a.run()
	t.Cleanup(a.stop)
	ada, bob := newFakeSeat(), newFakeSeat()
	bob.slow = true
	a.join("ada", ada)
	a.join("bob", bob)
	ada.next(t)
	settle(a)
	clock.Advance(grace)
	settle(a)
	settle(a)
	var final map[string]any
	for final == nil {
		if m := ada.next(t); m["type"] == "final" {
			final = m
		}
	}
	if final["winner"] != "ada" {
		t.Fatalf("got %v", final)
	}
}

func TestARejoinDuringThePauseGetsTheRevealItMissed(t *testing.T) {
	a, _, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.answer("ada", 1, 0)
	a.answer("bob", 1, 1)
	settle(a)
	ada.next(t) // the reveal, which Bob's dropping socket never shows him
	a.leave("bob", bob)
	settle(a)
	back := newFakeSeat()
	a.join("bob", back)
	settle(a)
	if m := back.next(t); m["type"] != "resume" || m["n"] != float64(1) {
		t.Fatalf("got %v", m)
	}
	if m := back.next(t); m["type"] != "reveal" || m["n"] != float64(1) || m["correct"] != float64(0) {
		t.Fatalf("got %v", m)
	}
}

// A rejoin mid-round sees the totals as the round began, so it can't learn how the other
// player answered.
func TestARejoinMidRoundSeesTotalsAsTheRoundBegan(t *testing.T) {
	a, _, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.leave("bob", bob)
	a.answer("ada", 1, 0)
	settle(a)
	back := newFakeSeat()
	a.join("bob", back)
	settle(a)
	resume := back.next(t)
	if resume["answered"] != false || resume["totals"].(map[string]any)["ada"] != float64(0) {
		t.Fatalf("got %v", resume)
	}
}

// The whole restart: rounds played, the server stopped mid-match (its snapshot kept), a
// new server on the same store, both back: on from the next round with the totals.
func TestAMatchSurvivesItsServerRestarting(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	clock := newFakeClock()
	first := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	a, _ := first.get(context.Background(), "m")
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	playRound(t, a, clock, ada, bob, 1)
	playRound(t, a, clock, ada, bob, 2)
	ada.next(t) // round 3 has begun when the server stops
	bob.next(t)
	first.stopAll()
	if reason := <-ada.closed; reason != "server shutting down" {
		t.Fatalf("closed with %q", reason)
	}

	second := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	b, err := second.get(context.Background(), "m")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(b.stop)
	ada2, bob2 := newFakeSeat(), newFakeSeat()
	b.join("ada", ada2)
	b.join("bob", bob2)
	if m := ada2.next(t); m["type"] != "resume" || m["n"] != float64(3) || m["totals"].(map[string]any)["ada"] != float64(300) {
		t.Fatalf("got %v", m)
	}
	if m := ada2.next(t); m["type"] != "round" || m["n"] != float64(3) {
		t.Fatalf("got %v", m)
	}
}

// Owner, 2026-11-02: after a restart players get 60 s; whoever isn't back abandons.
func TestAfterARestartWhoeverIsNotBackAbandons(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	_ = store.save(context.Background(), "m", snap{Next: 3, Totals: map[string]int{"ada": 100, "bob": 300}})
	clock := newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	a, _ := g.get(context.Background(), "m")
	ada := newFakeSeat()
	a.join("ada", ada)
	settle(a)
	clock.Advance(joinWait)
	settle(a)
	final := ada.next(t)
	if final["type"] != "final" || final["winner"] != "ada" {
		t.Fatalf("got %v", final)
	}
	if saved, _, _ := store.snapshot(context.Background(), "m"); !saved.Over {
		t.Fatal("not over")
	}

	// Nobody back: void, over, no winner to tell.
	store2 := newMemStore(map[string]matchDef{"m": sevenRounds()})
	_ = store2.save(context.Background(), "m", snap{Next: 3})
	g2 := newRegistry(store2, clock, slog.New(slog.DiscardHandler))
	b, _ := g2.get(context.Background(), "m")
	settle(b)
	clock.Advance(joinWait)
	select {
	case <-b.ended:
	case <-time.After(2 * time.Second):
		t.Fatal("a match nobody came back to didn't end")
	}
	if saved, _, _ := store2.snapshot(context.Background(), "m"); !saved.Over {
		t.Fatal("not over")
	}
}

func TestASnapshotRoundTripsThroughJSON(t *testing.T) {
	in := snap{Next: 5, Totals: map[string]int{"a": 300}, Times: map[string]time.Duration{"a": 2500 * time.Millisecond}}
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out snap
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if out.Next != 5 || out.Totals["a"] != 300 || out.Times["a"] != 2500*time.Millisecond || out.Over {
		t.Fatalf("got %+v", out)
	}
}

func TestAFailedSnapshotIsLoggedAndPlayGoesOn(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	store.fail = true
	var logs bytes.Buffer
	clock := newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.NewJSONHandler(&logs, nil)))
	a, _ := g.get(context.Background(), "m")
	t.Cleanup(a.stop)
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	playRound(t, a, clock, ada, bob, 1)
	if r := ada.next(t); r["n"] != float64(2) {
		t.Fatalf("play stopped: %v", r)
	}
	var line map[string]any
	_ = json.Unmarshal([]byte(strings.SplitN(logs.String(), "\n", 2)[0]), &line)
	if line["msg"] != "game: snapshot failed" || line["match"] != "m" {
		t.Fatalf("logged %q", logs.String())
	}
}

// Over real sockets: Bob's connection drops, he comes back on a new ticket in time.
func TestAPlayerReconnectsOverANewSocket(t *testing.T) {
	f := loadFixtures(t)
	srv, _ := testServer(t, f)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ticket := func(nonce string) string {
		return signForTest(t, claims{M: f.Claims.M, U: "user-2", S: "0", E: f.Now + 60, N: nonce}, f.Secret)
	}
	dial := func(tk string) *websocket.Conn {
		conn, _, err := websocket.Dial(ctx, socketURL(srv, "0", tk), nil)
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
	ada, bob := dial(f.Valid), dial(ticket("bob-1"))
	read(ada) // joined
	read(bob)
	read(ada) // round 1
	read(bob)
	_ = bob.CloseNow()
	again := dial(ticket("bob-2"))
	if m := read(again); m["type"] != "joined" {
		t.Fatalf("got %v", m)
	}
	if m := read(again); m["type"] != "resume" {
		t.Fatalf("got %v", m)
	}
	if m := read(again); m["type"] != "round" || m["n"] != float64(1) {
		t.Fatalf("got %v", m)
	}
}
