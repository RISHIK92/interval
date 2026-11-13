package main

import (
	"maps"
	"testing"
	"time"
)

// P5-W32 (C-03, Q-P5-18): rooms of up to 4, and every battle's placings.

func TestABattlePlacesByPointsThenTimeTheAbandonedLast(t *testing.T) {
	got := places(
		[]string{"gone", "late", "best", "early", "same", "gone2"},
		map[string]int{"gone": 900, "late": 700, "best": 1000, "early": 700, "same": 700, "gone2": 0},
		map[string]time.Duration{"gone": time.Minute, "late": 9 * time.Minute, "best": 8 * time.Minute, "early": 5 * time.Minute, "same": 9 * time.Minute, "gone2": 0},
		[]string{"gone", "gone2"},
	)
	want := map[string]int{"best": 1, "early": 2, "late": 3, "same": 3, "gone": 5, "gone2": 5}
	if !maps.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestABattleHasAtMostFourPlayers(t *testing.T) {
	five := battleJSON(t, func(m map[string]any) {
		m["players"] = []any{"a", "b", "c", "d", "e"}
	})
	if _, err := parseMatch(five); err == nil {
		t.Fatal("a battle of 5 was accepted")
	}
	four := battleJSON(t, func(m map[string]any) {
		m["players"] = []any{"a", "b", "c", "d"}
	})
	if _, err := parseMatch(four); err != nil {
		t.Fatalf("a room of 4: %v", err)
	}
}

func TestABattlesFinalNamesEveryonesPlace(t *testing.T) {
	a, clock, _, ada, _ := startBattle(t)
	send(a, clock, "ada", "submit", "none")
	nextOf(t, ada, "submitted")
	settle(a)
	clock.Advance(battleLength)
	final := nextOf(t, ada, "final")
	got, _ := final["places"].(map[string]any)
	if got["ada"] != float64(1) || got["bob"] != float64(2) {
		t.Fatalf("ada submitted (0 points, but in time), bob never did: %v", final)
	}
}
