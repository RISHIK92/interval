package main

import (
	"context"
	"testing"
	"time"
)

// P5-W31-S04a (§6.9, Q-P5-17): a battle's fair-play signals. A paste of 200 or more
// characters not already in the editor (checked by the page), and a focus loss of 30 s
// or more, are signals; the worker flags them for review. Nothing here penalises.

func sendSignal(a *actor, player, kind string, chars int, at time.Time) {
	a.post(event{kind: kind, player: player, n: chars, at: at})
}

func TestABattleCountsLongAwaysAndBigPastesOnly(t *testing.T) {
	a, clock, store, ada, _ := startBattle(t)
	t0 := clock.Now()
	// A glance away (10 s), then a long one (40 s) starting in minute 3; a second blur
	// while away doesn't restart it.
	sendSignal(a, "ada", "focus", 0, t0.Add(time.Minute))
	sendSignal(a, "ada", "back", 0, t0.Add(time.Minute+10*time.Second))
	sendSignal(a, "ada", "focus", 0, t0.Add(2*time.Minute+30*time.Second))
	sendSignal(a, "ada", "focus", 0, t0.Add(2*time.Minute+50*time.Second))
	sendSignal(a, "ada", "back", 0, t0.Add(3*time.Minute+10*time.Second))
	sendSignal(a, "ada", "back", 0, t0.Add(4*time.Minute)) // back without leaving: nothing
	sendSignal(a, "ada", "paste", 199, t0.Add(5*time.Minute))
	sendSignal(a, "ada", "paste", 640, t0.Add(6*time.Minute+5*time.Second))
	settle(a)
	clock.Advance(battleLength)
	nextOf(t, ada, "final")
	resultOf(t, store)
	got := signalsOf(t, store, "ada")
	if len(got) != 2 {
		t.Fatalf("want an away and a paste, got %+v", got)
	}
	away, paste := got[0], got[1]
	if away.Kind != "away" || away.Round != 3 || away.Ms == nil || *away.Ms != 40_000 || away.Chars != nil {
		t.Fatalf("away: %+v", away)
	}
	if paste.Kind != "paste" || paste.Round != 7 || paste.Chars == nil || *paste.Chars != 640 || paste.Ms != nil {
		t.Fatalf("paste: %+v", paste)
	}
	if bob := signalsOf(t, store, "bob"); len(bob) != 0 {
		t.Fatalf("bob: %+v", bob)
	}
}

func TestAnAwayStillOpenAtTheEndCounts(t *testing.T) {
	a, clock, store, ada, _ := startBattle(t)
	sendSignal(a, "bob", "focus", 0, clock.Now().Add(44*time.Minute))
	settle(a)
	clock.Advance(battleLength)
	nextOf(t, ada, "final")
	resultOf(t, store)
	got := signalsOf(t, store, "bob")
	if len(got) != 1 || got[0].Kind != "away" || got[0].Round != 45 || *got[0].Ms != 60_000 {
		t.Fatalf("got %+v", got)
	}
}

func TestABattleKeepsAtMost20SignalsOfAKind(t *testing.T) {
	a, clock, store, ada, _ := startBattle(t)
	t0 := clock.Now()
	for i := range 30 {
		at := t0.Add(time.Duration(i) * time.Minute)
		sendSignal(a, "ada", "paste", 500, at)
		sendSignal(a, "ada", "focus", 0, at)
		sendSignal(a, "ada", "back", 0, at.Add(31*time.Second))
	}
	settle(a)
	clock.Advance(battleLength)
	nextOf(t, ada, "final")
	resultOf(t, store)
	kinds := map[string]int{}
	for _, s := range signalsOf(t, store, "ada") {
		kinds[s.Kind]++
	}
	if kinds["paste"] != 20 || kinds["away"] != 20 || len(kinds) != 2 {
		t.Fatalf("got %v", kinds)
	}
}

func TestABattleSignalIsSavedForARestartAtOnce(t *testing.T) {
	a, clock, store, _, _ := startBattle(t)
	sendSignal(a, "ada", "paste", 640, clock.Now())
	settle(a)
	saved, ok, _ := store.snapshot(context.Background(), "b1")
	if !ok || len(saved.Signals["ada"]) != 1 || saved.Signals["ada"][0].Kind != "paste" {
		t.Fatalf("snapshot: %+v", saved)
	}
}

// A page whose socket drops can't say it's back: the away ends at the drop, not at the
// battle's end.
func TestAnAwayEndsWhenTheSocketDrops(t *testing.T) {
	a, clock, store, ada, bob := startBattle(t)
	sendSignal(a, "ada", "focus", 0, clock.Now())
	settle(a)
	clock.Advance(40 * time.Second)
	a.leave("ada", ada)
	settle(a)
	clock.Advance(battleLength)
	nextOf(t, bob, "final")
	resultOf(t, store)
	got := signalsOf(t, store, "ada")
	if len(got) != 1 || got[0].Kind != "away" || *got[0].Ms != 40_000 {
		t.Fatalf("got %+v", got)
	}
}

// Read after time is up (while judgings finish): an away counts to the end, a paste not.
func TestNothingCountsPastTheEnd(t *testing.T) {
	a, clock, store, ada, _ := startBattle(t)
	t0 := clock.Now()
	sendSignal(a, "ada", "focus", 0, t0.Add(44*time.Minute))
	sendSignal(a, "ada", "back", 0, t0.Add(46*time.Minute))
	sendSignal(a, "ada", "paste", 900, t0.Add(46*time.Minute))
	settle(a)
	clock.Advance(battleLength)
	nextOf(t, ada, "final")
	resultOf(t, store)
	got := signalsOf(t, store, "ada")
	if len(got) != 1 || got[0].Kind != "away" || *got[0].Ms != 60_000 {
		t.Fatalf("got %+v", got)
	}
}
