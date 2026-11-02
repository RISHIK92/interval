package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"
)

// P3-W15-S05: every ending hands the worker one result (game:results), with each
// player's answers; the message is pinned by a golden file the Python side validates.

func registryWith(t *testing.T, store *memStore, clock *fakeClock) (*actor, *fakeSeat, *fakeSeat) {
	t.Helper()
	g := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	a, err := g.get(context.Background(), "m")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.stop)
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	return a, ada, bob
}

func waitEnded(t *testing.T, a *actor) {
	t.Helper()
	select {
	case <-a.ended:
	case <-time.After(2 * time.Second):
		t.Fatal("the match didn't end")
	}
}

func TestAFinishedMatchHandsItsResultOver(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	clock := newFakeClock()
	a, ada, bob := registryWith(t, store, clock)
	for n := 1; n <= 6; n++ {
		playRound(t, a, clock, ada, bob, n)
	}
	ada.next(t) // round 7: only Ada answers, Bob runs out of time
	bob.next(t)
	clock.Advance(2 * time.Second)
	a.answer("ada", 7, 2)
	settle(a)
	clock.Advance(roundTime)
	settle(a)
	waitEnded(t, a)
	results := store.results()
	if len(results) != 1 {
		t.Fatalf("%d results", len(results))
	}
	r := results[0]
	if r.MatchID != "m" || r.Outcome != "finished" || r.Winner == nil || *r.Winner != "ada" {
		t.Fatalf("got %+v", r)
	}
	ada0, bob0 := r.Players[0], r.Players[1]
	if ada0.PlayedAs != "ada" || len(ada0.Answers) != 7 || bob0.PlayedAs != "bob" || len(bob0.Answers) != 7 {
		t.Fatalf("players: %+v", r.Players)
	}
	first := ada0.Answers[0]
	if first.Round != 1 || first.QuestionID != 100 || *first.Choice != 0 || !*first.Correct || *first.Ms != 0 {
		t.Fatalf("ada's first: %+v", first)
	}
	last := bob0.Answers[6]
	if last.Round != 7 || last.Choice != nil || last.Correct != nil || last.Ms != nil {
		t.Fatalf("bob's unanswered: %+v", last)
	}
	if !strings.HasPrefix(r.FinishedAt, "2027-") || ada0.Abandoned {
		t.Fatalf("got %+v", r)
	}
}

func TestEveryEndingHandsOneResult(t *testing.T) {
	// Abandoned: Bob gone past his grace.
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	clock := newFakeClock()
	a, ada, bob := registryWith(t, store, clock)
	ada.next(t)
	bob.next(t)
	a.leave("bob", bob)
	settle(a)
	clock.Advance(grace)
	settle(a)
	waitEnded(t, a)
	if r := store.results(); len(r) != 1 || r[0].Outcome != "abandoned" || !r[0].Players[1].Abandoned || *r[0].Winner != "ada" {
		t.Fatalf("abandoned: %+v", r)
	}

	// Cancelled: never started.
	store = newMemStore(map[string]matchDef{"m": sevenRounds()})
	clock = newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	c, _ := g.get(context.Background(), "m")
	c.join("ada", newFakeSeat())
	settle(c)
	clock.Advance(joinWait)
	waitEnded(t, c)
	if r := store.results(); len(r) != 1 || r[0].Outcome != "cancelled" || r[0].Winner != nil {
		t.Fatalf("cancelled: %+v", r)
	}

	// Void: restarted, nobody came back.
	store = newMemStore(map[string]matchDef{"m": sevenRounds()})
	_ = store.save(context.Background(), "m", snap{Next: 3})
	clock = newFakeClock()
	g = newRegistry(store, clock, slog.New(slog.DiscardHandler))
	v, _ := g.get(context.Background(), "m")
	settle(v)
	clock.Advance(joinWait)
	waitEnded(t, v)
	if r := store.results(); len(r) != 1 || r[0].Outcome != "void" {
		t.Fatalf("void: %+v", r)
	}
}

func TestAResultNotHandedOverIsTriedThriceAndLogged(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sevenRounds()})
	store.failPush = true
	var logs bytes.Buffer
	clock := newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.NewJSONHandler(&logs, nil)))
	a, _ := g.get(context.Background(), "m")
	a.join("ada", newFakeSeat())
	settle(a)
	clock.Advance(joinWait)
	waitEnded(t, a)
	if n := strings.Count(logs.String(), `"msg":"game: result not handed over"`); n != 3 {
		t.Fatalf("%d failure lines, want 3:\n%s", n, logs.String())
	}
}

// The message the worker validates (workers/jobs/tests/test_match_results.py reads this
// file). Regenerate with UPDATE_GOLDEN=1 go test -run Golden.
func TestTheResultMatchesItsGoldenFile(t *testing.T) {
	right, wrong, choice0, choice2, ms := true, false, 0, 2, int64(2950)
	ada := "user-1"
	r := result{
		MatchID:    "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b",
		FinishedAt: "2026-11-02T12:05:00Z",
		Outcome:    "finished",
		Winner:     &ada,
		Players: []playerResult{
			{PlayedAs: "user-1", Total: 140, TimeMs: 2950, Answers: []answerRec{
				{Round: 1, QuestionID: 41, Choice: &choice0, Correct: &right, Ms: &ms},
			}},
			{PlayedAs: "user-2", Total: 0, TimeMs: 15000, Abandoned: false, Answers: []answerRec{
				{Round: 1, QuestionID: 41, Choice: &choice2, Correct: &wrong, Ms: &ms},
			}},
		},
	}
	got, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	got = append(got, '\n')
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile("testdata/match_finished.json", got, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile("testdata/match_finished.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("the result's shape changed:\n%s\nwant:\n%s", got, want)
	}
}
