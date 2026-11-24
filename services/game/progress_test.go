package main

import (
	"testing"
	"time"
)

// Q-WD-14 (owner, 2026-11-23): each player sees each opponent's best tests passed, as
// counts: the base layers, and the extension's only once it's revealed (LLDQ-4: never
// which tests).

// The progress map of a message, as {player: [passed, total]}.
func progressOf(t *testing.T, m map[string]any) map[string][2]int {
	t.Helper()
	raw, ok := m["progress"].(map[string]any)
	if !ok {
		t.Fatalf("no progress: %v", m)
	}
	out := map[string][2]int{}
	for player, v := range raw {
		c := v.(map[string]any)
		out[player] = [2]int{int(c["passed"].(float64)), int(c["total"].(float64))}
	}
	return out
}

func TestEachPlayerSeesEachOpponentsBestTestsPassed(t *testing.T) {
	a, clock, _, ada, bob := startBattle(t)
	// The start had it too: nobody has passed any of the 4 base tests.
	ada2 := newFakeSeat()
	a.join("ada", ada2)
	if got := progressOf(t, nextOf(t, ada2, "battle")); got["ada"] != [2]int{0, 4} || got["bob"] != [2]int{0, 4} {
		t.Fatalf("at the start: %v", got)
	}
	ada = ada2
	send(a, clock, "ada", "submit", "perfect")
	nextOf(t, ada, "submitted")
	if got := progressOf(t, nextOf(t, bob, "best")); got["ada"] != [2]int{4, 4} || got["bob"] != [2]int{0, 4} {
		t.Fatalf("bob sees ada's 4 of 4: %v", got)
	}
	// The reveal adds the extension's test to every total.
	settle(a)
	clock.Advance(battleReveal)
	settle(a)
	nextOf(t, bob, "extension")
	if got := progressOf(t, nextOf(t, bob, "best")); got["ada"] != [2]int{4, 5} {
		t.Fatalf("after the reveal: %v", got)
	}
	// A worse submission leaves the best's count.
	send(a, clock, "bob", "submit", "none")
	nextOf(t, bob, "submitted")
	if got := progressOf(t, nextOf(t, bob, "best")); got["bob"] != [2]int{0, 5} || got["ada"] != [2]int{4, 5} {
		t.Fatalf("%v", got)
	}
	settle(a)
	send(a, clock, "ada", "submit", "perfect")
	nextOf(t, ada, "submitted")
	if got := progressOf(t, nextOf(t, ada, "best")); got["ada"] != [2]int{5, 5} {
		t.Fatalf("ada's perfect after the reveal: %v", got)
	}
}

func TestARestartKeepsEachBestsTestsPassed(t *testing.T) {
	def, err := parseMatch(battleJSON(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	clock := newFakeClock()
	a := newActor("b1", def, clock, nil)
	a.judge = fakeJudge{}
	var saved snap
	a.save = func(s snap) { saved = s }
	a.from = &snap{Started: clock.Now().Add(-10 * time.Minute), Totals: map[string]int{"ada": 700},
		Times: map[string]time.Duration{"ada": time.Minute}, Passed: map[string]int{"ada": 4}}
	go a.run()
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	if got := progressOf(t, nextOf(t, ada, "battle")); got["ada"] != [2]int{4, 4} || got["bob"] != [2]int{0, 4} {
		t.Fatalf("ada's 4 of 4 kept: %v", got)
	}
	settle(a)
	if saved.Passed["ada"] != 4 {
		t.Fatalf("saved again with it: %+v", saved)
	}
}
