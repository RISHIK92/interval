package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Q-WD-17 (owner, 2026-11-23; ×10, owner, 2026-11-24): "Stuck? Hints cost points": Nudge
// −10, Approach −30, Code sketch −60, in both battle modes, free in practice. Each level opens once per match,
// its cost comes off the best submission's points (never below 0), and the result
// records it. A hint's text is sent only when asked for, and only to its player.

func withHints(m map[string]any) {
	m["battle"].(map[string]any)["hints"] = []any{"Think about recency.", "A map and a list.", "get(k):\n  move to front"}
}

func hint(a *actor, player string, level int) {
	a.post(event{kind: "hint", player: player, n: level})
}

// The hints part of a battle message: costs, the opened texts by level, and the spend.
func hintsOf(t *testing.T, m map[string]any) (costs []float64, opened map[int]string, spent float64) {
	t.Helper()
	h, ok := m["hints"].(map[string]any)
	if !ok {
		t.Fatalf("no hints: %v", m)
	}
	for _, c := range h["costs"].([]any) {
		costs = append(costs, c.(float64))
	}
	opened = map[int]string{}
	for _, o := range h["opened"].([]any) {
		o := o.(map[string]any)
		opened[int(o["level"].(float64))] = o["text"].(string)
	}
	return costs, opened, h["spent"].(float64)
}

func TestHintsCostPointsOffTheBestAndAreRecorded(t *testing.T) {
	a, clock, store, ada, bob := startBattle(t, withHints)
	// Nothing preloaded: the costs, and no text.
	ada2 := newFakeSeat()
	a.join("ada", ada2)
	ada = ada2
	costs, opened, spent := hintsOf(t, nextOf(t, ada, "battle"))
	if len(costs) != 3 || costs[0] != 10 || costs[1] != 30 || costs[2] != 60 || len(opened) != 0 || spent != 0 {
		t.Fatalf("the start: %v %v %v", costs, opened, spent)
	}
	hint(a, "ada", 1)
	if m := nextOf(t, ada, "hint"); m["level"] != float64(1) || m["text"] != "Think about recency." || m["spent"] != float64(10) {
		t.Fatalf("the nudge: %v", m)
	}
	hint(a, "ada", 2)
	if m := nextOf(t, ada, "hint"); m["text"] != "A map and a list." || m["spent"] != float64(40) {
		t.Fatalf("the approach: %v", m)
	}
	send(a, clock, "ada", "submit", "perfect")
	// The best that counts: 700 less the hints.
	if sub := nextOf(t, ada, "submitted"); sub["points"] != float64(700) || sub["best"] != float64(660) {
		t.Fatalf("%v", sub)
	}
	// The opponent never gets the text.
	settle(a)
	for len(bob.out) > 0 {
		if m := bob.next(t); m["type"] == "hint" {
			t.Fatalf("bob was sent ada's hint: %v", m)
		}
	}
	settle(a)
	clock.Advance(battleLength)
	final := nextOf(t, bob, "final")
	if final["totals"].(map[string]any)["ada"] != float64(660) {
		t.Fatalf("%v", final)
	}
	r := resultOf(t, store)
	if p := r.Players[0]; p.Total != 660 || p.HintCost != 40 || len(p.Hints) != 2 || p.Hints[0] != 1 || p.Hints[1] != 2 {
		t.Fatalf("the result records the hints: %+v", p)
	}
	if p := r.Players[1]; p.HintCost != 0 || p.Hints != nil {
		t.Fatalf("bob took none: %+v", p)
	}
}

func TestAHintOpensOnceAndNeverTakesPointsBelowZero(t *testing.T) {
	a, clock, store, ada, _ := startBattle(t, withHints)
	hint(a, "ada", 3)
	nextOf(t, ada, "hint")
	// Asked again (another tab): the same text, not charged again.
	hint(a, "ada", 3)
	if m := nextOf(t, ada, "hint"); m["text"] != "get(k):\n  move to front" || m["spent"] != float64(60) {
		t.Fatalf("%v", m)
	}
	// No level 0 or 4, and nothing for a non-player.
	hint(a, "ada", 0)
	hint(a, "ada", 4)
	hint(a, "eve", 1)
	send(a, clock, "ada", "submit", "none") // 0 points: 0, not −60
	if sub := nextOf(t, ada, "submitted"); sub["best"] != float64(0) {
		t.Fatalf("%v", sub)
	}
	settle(a)
	clock.Advance(battleLength)
	r := resultOf(t, store)
	if p := r.Players[0]; p.Total != 0 || p.HintCost != 60 || len(p.Hints) != 1 {
		t.Fatalf("%+v", p)
	}
}

func TestARestartNeitherRefundsNorChargesAHintAgain(t *testing.T) {
	def, err := parseMatch(battleJSON(t, withHints))
	if err != nil {
		t.Fatal(err)
	}
	clock := newFakeClock()
	store := newMemStore(map[string]matchDef{"b1": def})
	a := newActor("b1", def, clock, nil)
	a.judge = fakeJudge{}
	wire(a, store)
	a.from = &snap{Started: clock.Now().Add(-44 * time.Minute), Totals: map[string]int{"ada": 700},
		Times: map[string]time.Duration{"ada": time.Minute}, Hints: map[string][]int{"ada": {0, 3, 5, 3}}} // only 3 is a level, once
	go a.run()
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	m := nextOf(t, ada, "battle")
	if _, opened, spent := hintsOf(t, m); opened[3] != "get(k):\n  move to front" || len(opened) != 1 || spent != 60 {
		t.Fatalf("the sketch stays open, and paid for: %v", m)
	}
	if m["best"].(map[string]any)["ada"] != float64(640) {
		t.Fatalf("%v", m)
	}
	hint(a, "ada", 3)
	nextOf(t, ada, "hint")
	settle(a)
	clock.Advance(time.Minute)
	r := resultOf(t, store)
	if p := r.Players[0]; p.Total != 640 || p.HintCost != 60 || len(p.Hints) != 1 {
		t.Fatalf("%+v", p)
	}
}

func TestAHintSavesBeforeItsTextGoesAndOnlyThatSaveRetries(t *testing.T) {
	a, clock, store, ada, _ := startBattle(t, withHints)
	var saved []snap
	a.save = func(s snap) {
		saved = append(saved, s)
		_ = store.save(context.Background(), "b1", s)
	}
	hint(a, "ada", 2)
	nextOf(t, ada, "hint")
	if s, ok, _ := store.snapshot(context.Background(), "b1"); !ok || len(s.Hints["ada"]) != 1 || s.Hints["ada"][0] != 2 {
		t.Fatalf("saved: %+v", s)
	}
	send(a, clock, "ada", "submit", "none")
	nextOf(t, ada, "submitted")
	settle(a)
	// The hint's save is retried (lost, a restart would refund it); the later one isn't.
	if len(saved) != 2 || !saved[0].Retry || saved[1].Retry {
		t.Fatalf("%+v", saved)
	}
}

// Q-WD-17 (owner, 2026-11-24): a hint taken is public, as its levels, live; its text and
// the points it cost stay the player's own until the results.
func TestOpponentsSeeWhichHintsButNeverTheirTextOrCost(t *testing.T) {
	a, clock, _, ada, bob := startBattle(t, withHints)
	hint(a, "ada", 2)
	// Ada's own best is net of it (nothing yet, so 0); bob will see the scored one.
	if m := nextOf(t, ada, "best"); m["best"].(map[string]any)["ada"] != float64(0) {
		t.Fatalf("ada's own: %v", m)
	}
	nextOf(t, ada, "hint")
	m := nextOf(t, bob, "best")
	if levels := m["progress"].(map[string]any)["ada"].(map[string]any)["hints"].([]any); len(levels) != 1 || levels[0] != float64(2) {
		t.Fatalf("bob sees ada opened the approach: %v", m)
	}
	settle(a)
	for len(bob.out) > 0 {
		if m := bob.next(t); m["type"] == "hint" {
			t.Fatalf("bob was sent ada's hint: %v", m)
		}
	}
	send(a, clock, "ada", "submit", "perfect")
	if m := nextOf(t, ada, "best"); m["best"].(map[string]any)["ada"] != float64(670) {
		t.Fatalf("ada's own: %v", m)
	}
	if m := nextOf(t, bob, "best"); m["best"].(map[string]any)["ada"] != float64(700) {
		t.Fatalf("bob's view: %v", m)
	}
	bob2 := newFakeSeat()
	a.join("bob", bob2)
	m = nextOf(t, bob2, "battle")
	if m["best"].(map[string]any)["ada"] != float64(700) ||
		len(m["progress"].(map[string]any)["ada"].(map[string]any)["hints"].([]any)) != 1 {
		t.Fatalf("bob back: %v", m)
	}
	if _, opened, spent := hintsOf(t, m); len(opened) != 0 || spent != 0 {
		t.Fatalf("bob's hints are his own: %v", m)
	}
	raw, _ := json.Marshal(m)
	if strings.Contains(string(raw), "A map and a list.") {
		t.Fatalf("the text reached bob: %s", raw)
	}
}

func TestHintsCostTheSameInTheAIMode(t *testing.T) {
	a, clock, store, ada, _ := startBattle(t, withHints, func(m map[string]any) {
		m["battle"].(map[string]any)["battle_mode"] = "ai"
	})
	hint(a, "ada", 2)
	nextOf(t, ada, "hint")
	send(a, clock, "ada", "submit", "perfect")
	nextOf(t, ada, "submitted")
	settle(a)
	clock.Advance(battleLength)
	if p := resultOf(t, store).Players[0]; p.Total != 670 || p.HintCost != 30 {
		t.Fatalf("%+v", p)
	}
}

func TestPracticeHintsAreFree(t *testing.T) {
	a, clock, store, ada := startPractice(t, withHints)
	ada2 := newFakeSeat()
	a.join("ada", ada2)
	if costs, _, _ := hintsOf(t, nextOf(t, ada2, "battle")); costs[0] != 0 || costs[1] != 0 || costs[2] != 0 {
		t.Fatalf("free: %v", costs)
	}
	ada = ada2
	hint(a, "ada", 3)
	if m := nextOf(t, ada, "hint"); m["spent"] != float64(0) {
		t.Fatalf("%v", m)
	}
	send(a, clock, "ada", "submit", "perfect")
	if sub := nextOf(t, ada, "submitted"); sub["best"] != float64(700) {
		t.Fatalf("%v", sub)
	}
	settle(a)
	clock.Advance(practiceLength)
	if p := resultOf(t, store).Players[0]; p.Total != 700 || p.HintCost != 0 {
		t.Fatalf("%+v", p)
	}
}

func TestABattleWithoutHintsSaysSoAndIgnoresAsks(t *testing.T) {
	a, _, _, ada, _ := startBattle(t)
	hint(a, "ada", 1)
	settle(a)
	ada2 := newFakeSeat()
	a.join("ada", ada2)
	if m := nextOf(t, ada2, "battle"); m["hints"] != nil {
		t.Fatalf("%v", m)
	}
	for len(ada.out) > 0 {
		if m := ada.next(t); m["type"] == "hint" {
			t.Fatalf("%v", m)
		}
	}
}

func TestABattlesHintsAreAllThreeLevels(t *testing.T) {
	for name, hints := range map[string][]any{
		"two levels":  {"a", "b"},
		"empty level": {"a", "", "c"},
	} {
		if _, err := parseMatch(battleJSON(t, func(m map[string]any) { m["battle"].(map[string]any)["hints"] = hints })); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestParseHintTakesALevel(t *testing.T) {
	if n, ok := parseHint([]byte(`{"type":"hint","level":2}`)); !ok || n != 2 {
		t.Fatalf("%v %v", n, ok)
	}
	for _, raw := range []string{`{"type":"hint"}`, `{"type":"hint","level":"2"}`, `{"type":"reveal","level":1}`} {
		if _, ok := parseHint([]byte(raw)); ok {
			t.Errorf("%s: taken", raw)
		}
	}
}

// The worker reads these names (workers/jobs: PlayerResult.hints, hint_cost); a player
// who opened none sends neither.
func TestTheResultNamesTheHintsAsTheWorkerReadsThem(t *testing.T) {
	raw, _ := json.Marshal(playerResult{PlayedAs: "ada", Hints: []int{1, 3}, HintCost: 70})
	var got map[string]any
	_ = json.Unmarshal(raw, &got)
	if got["hint_cost"] != float64(70) || len(got["hints"].([]any)) != 2 {
		t.Fatalf("%s", raw)
	}
	raw, _ = json.Marshal(playerResult{PlayedAs: "bob"})
	if strings.Contains(string(raw), "hint") {
		t.Fatalf("%s", raw)
	}
}
