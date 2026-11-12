package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"interval/services/game/judge"
)

// P5-W31-S02b-2 (§6.5; Q-P5-15, Q-P5-16): a battle played by its actor against a fake
// judge, on a fake clock.

// Judges by the code: "perfect" passes every run, "none" fails every run, "error" is
// the judge's own failure, and "slow" passes once the test lets it go.
type fakeJudge struct{ release chan struct{} }

func (f fakeJudge) Judge(ctx context.Context, job judge.JudgeJob) (judge.JudgeResult, error) {
	code := *job.Files[0].Content
	if code == "error" {
		return judge.JudgeResult{}, errors.New("velox down")
	}
	if code == "slow" {
		select {
		case <-f.release:
			code = "perfect"
		case <-ctx.Done():
			return judge.JudgeResult{}, ctx.Err()
		}
	}
	done, ok := "done", "ok"
	result := judge.JudgeResult{Id: job.Id, Status: &done}
	for range job.Runs {
		passed := code == "perfect"
		ms := int64(3)
		result.Runs = append(result.Runs, judge.RunResult{Verdict: &ok, TimeMs: &ms, Report: &judge.Report{Passed: &passed}})
	}
	return result, nil
}

// Lets a "slow" judging finish.
var release = make(chan struct{}, 16)

func startBattle(t *testing.T) (*actor, *fakeClock, *memStore, *fakeSeat, *fakeSeat) {
	t.Helper()
	def, err := parseMatch(battleJSON(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	store := newMemStore(map[string]matchDef{"b1": def})
	clock := newFakeClock()
	a := newActor("b1", def, clock, nil)
	a.judge = fakeJudge{release: release}
	a.save = func(s snap) { _ = store.save(context.Background(), "b1", s) }
	a.publish = func(r result) {
		raw, _ := json.Marshal(r)
		_ = store.publish(context.Background(), "b1", raw)
	}
	go a.run()
	t.Cleanup(a.stop)
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	for _, s := range []*fakeSeat{ada, bob} {
		if m := s.next(t); m["type"] != "battle" || m["seconds"] != float64(45*60) || m["revealed"] != false {
			t.Fatalf("the battle's start: %v", m)
		}
	}
	return a, clock, store, ada, bob
}

// The battle's result, once its actor has handed it over (just after its final message).
func resultOf(t *testing.T, store *memStore) result {
	t.Helper()
	for range 200 {
		if r := store.results(); len(r) == 1 {
			return r[0]
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("no result: %+v", store.results())
	return result{}
}

func send(a *actor, clock *fakeClock, player, kind, code string) {
	a.post(event{kind: "code", player: player, at: clock.Now(), code: &codeMsg{submit: kind == "submit", language: "python", code: code}})
}

// The next message of a type, skipping others (best-score broadcasts).
func nextOf(t *testing.T, s *fakeSeat, kind string) map[string]any {
	t.Helper()
	for range 10 {
		if m := s.next(t); m["type"] == kind {
			return m
		}
	}
	t.Fatalf("no %s", kind)
	return nil
}

func TestABattleRunsSubmitsRevealsAndEndsWhenEveryoneIsPerfect(t *testing.T) {
	a, clock, store, ada, bob := startBattle(t)
	// Run: the visible tests, each with its verdict.
	send(a, clock, "ada", "run", "none")
	if ran := nextOf(t, ada, "ran"); len(ran["tests"].([]any)) != 1 {
		t.Fatalf("one visible test: %v", ran)
	}
	// A Run inside its 5 s cooldown is refused, with the wait.
	send(a, clock, "ada", "run", "none")
	if r := nextOf(t, ada, "refused"); r["reason"] != "wait 5 s" {
		t.Fatalf("%v", r)
	}
	// Submit before the reveal: everything passes but the extension isn't judged: 700.
	clock.Advance(time.Minute)
	send(a, clock, "ada", "submit", "perfect")
	sub := nextOf(t, ada, "submitted")
	if sub["points"] != float64(700) || sub["layers"].(map[string]any)["extension"] != nil {
		t.Fatalf("before the reveal: %v", sub)
	}
	if best := nextOf(t, bob, "best"); best["best"].(map[string]any)["ada"] != float64(700) {
		t.Fatalf("bob sees ada's best: %v", best)
	}
	// Hidden tests come back as counts only (LLDQ-4).
	if hidden := sub["layers"].(map[string]any)["hidden"].(map[string]any); hidden["passed"] != float64(2) || hidden["total"] != float64(2) {
		t.Fatalf("%v", hidden)
	}
	settle(a)
	clock.Advance(battleReveal - time.Minute)
	settle(a)
	if m := nextOf(t, ada, "extension"); m["seconds"] != float64(15*60) {
		t.Fatalf("the reveal: %v", m)
	}
	send(a, clock, "ada", "submit", "perfect")
	if sub := nextOf(t, ada, "submitted"); sub["points"] != float64(1000) {
		t.Fatalf("after the reveal: %v", sub)
	}
	clock.Advance(time.Minute)
	send(a, clock, "bob", "submit", "perfect")
	final := nextOf(t, ada, "final")
	if final["winner"] != "ada" { // equal points: ada reached them first
		t.Fatalf("%v", final)
	}
	if r := resultOf(t, store); r.Outcome != "finished" || r.Players[0].Total != 1000 {
		t.Fatalf("the result: %+v", r)
	}
}

func TestAPlayerWhoDropsIsAwayAndTheirBestStands(t *testing.T) {
	a, clock, store, ada, bob := startBattle(t)
	send(a, clock, "bob", "submit", "none") // bob has a submission, worth 0
	nextOf(t, bob, "submitted")
	settle(a)
	a.leave("bob", bob)
	settle(a)
	clock.Advance(grace)
	settle(a)
	// Away, not abandoned: the battle goes on, and ends at 45:00.
	clock.Advance(battleReveal)
	settle(a)
	send(a, clock, "ada", "submit", "none")
	nextOf(t, ada, "submitted")
	settle(a)
	clock.Advance(battleLength)
	nextOf(t, ada, "final")
	r := resultOf(t, store)
	if r.Outcome != "finished" || r.Players[1].Abandoned {
		t.Fatalf("bob submitted, so he didn't abandon: %+v", r)
	}
}

func TestEveryoneAwayEndsTheBattleAndNoSubmissionMeansAbandoned(t *testing.T) {
	a, clock, store, ada, bob := startBattle(t)
	send(a, clock, "ada", "submit", "none")
	nextOf(t, ada, "submitted")
	settle(a)
	a.leave("ada", ada)
	a.leave("bob", bob)
	settle(a)
	clock.Advance(grace)
	settle(a)
	// Nobody left: the battle ends.
	r := resultOf(t, store)
	if r.Outcome != "abandoned" || r.Players[0].Abandoned || !r.Players[1].Abandoned || r.Winner == nil || *r.Winner != "ada" {
		t.Fatalf("bob never submitted and never came back: %+v", r)
	}
}

func TestAFailedJudgingGivesTheCooldownBack(t *testing.T) {
	a, clock, _, ada, _ := startBattle(t)
	send(a, clock, "ada", "submit", "error")
	if m := nextOf(t, ada, "judge_error"); m["submit"] != true {
		t.Fatalf("%v", m)
	}
	settle(a)
	send(a, clock, "ada", "submit", "perfect") // at once: no 30 s wait
	nextOf(t, ada, "submitted")
}

func TestABattleRestartsOnItsOwnClock(t *testing.T) {
	def, err := parseMatch(battleJSON(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	clock := newFakeClock()
	started := clock.Now().Add(-40 * time.Minute)
	a := newActor("b1", def, clock, nil)
	a.judge = fakeJudge{}
	a.from = &snap{Started: started, Totals: map[string]int{"ada": 700}, Times: map[string]time.Duration{"ada": time.Minute}}
	go a.run()
	t.Cleanup(a.stop)
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	m := ada.next(t)
	if m["seconds"] != float64(5*60) || m["revealed"] != true || m["best"].(map[string]any)["ada"] != float64(700) {
		t.Fatalf("five minutes left, revealed, ada's best kept: %v", m)
	}
}

// Code is judged by when it was sent: a submission in before 45:00 counts though its
// judging ends after; so does one from a player who then drops, while nobody is left.
func TestCodeSentBeforeTheEndIsScoredAfterIt(t *testing.T) {
	a, clock, store, ada, _ := startBattle(t)
	clock.Advance(battleLength - 10*time.Second)
	send(a, clock, "ada", "submit", "slow")
	settle(a)
	clock.Advance(10 * time.Second) // 45:00: the end is decided, the judging still out
	settle(a)
	release <- struct{}{} // its two jobs: the base layers, then the extension
	release <- struct{}{}
	nextOf(t, ada, "submitted")
	r := resultOf(t, store)
	if r.Players[0].Total != 1000 || r.Players[0].Abandoned {
		t.Fatalf("ada's in-time submission counts: %+v", r)
	}
}

func TestEveryoneAwayWaitsForTheJudgingsInFlight(t *testing.T) {
	a, clock, store, ada, bob := startBattle(t)
	send(a, clock, "bob", "submit", "slow")
	settle(a)
	a.leave("ada", ada)
	a.leave("bob", bob)
	settle(a)
	clock.Advance(grace)
	settle(a)
	release <- struct{}{}
	r := resultOf(t, store)
	if r.Players[1].Abandoned || r.Players[1].Total != 700 || !r.Players[0].Abandoned {
		t.Fatalf("bob submitted before he left: %+v", r)
	}
}

func TestOneJudgingAtATimeAndTheSubmitCooldown(t *testing.T) {
	a, clock, _, ada, _ := startBattle(t)
	send(a, clock, "ada", "submit", "slow")
	settle(a)
	clock.Advance(time.Minute)
	send(a, clock, "ada", "submit", "none")
	if r := nextOf(t, ada, "refused"); r["code"] != "judging" {
		t.Fatalf("%v", r)
	}
	release <- struct{}{}
	nextOf(t, ada, "submitted")
	settle(a)
	clock.Advance(20 * time.Second) // 80 s after the accepted one
	send(a, clock, "ada", "submit", "none")
	nextOf(t, ada, "submitted")
	settle(a)
	clock.Advance(10 * time.Second)
	send(a, clock, "ada", "submit", "none")
	if r := nextOf(t, ada, "refused"); r["code"] != "cooldown" || r["reason"] != "wait 20 s" {
		t.Fatalf("%v", r)
	}
}

// A restarted battle waits for nobody: a player with a best who isn't back yet isn't
// abandoned, and may still come back (Q-P5-16).
func TestARestartedBattleWaitsForNobody(t *testing.T) {
	def, err := parseMatch(battleJSON(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	clock := newFakeClock()
	store := newMemStore(map[string]matchDef{"b1": def})
	a := newActor("b1", def, clock, nil)
	a.judge = fakeJudge{release: release}
	a.publish = func(r result) {
		raw, _ := json.Marshal(r)
		_ = store.publish(context.Background(), "b1", raw)
	}
	a.from = &snap{Started: clock.Now().Add(-44 * time.Minute), Totals: map[string]int{"bob": 300}, Times: map[string]time.Duration{"bob": time.Minute}}
	go a.run()
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	if m := ada.next(t); m["type"] != "battle" || m["seconds"] != float64(60) {
		t.Fatalf("ada is back alone, a minute left: %v", m)
	}
	settle(a)
	clock.Advance(joinWait + time.Minute)
	r := resultOf(t, store)
	if r.Players[1].Abandoned || r.Players[1].Total != 300 || *r.Winner != "bob" {
		t.Fatalf("bob's best stands though he never came back: %+v", r)
	}
}

func TestParseCodeTakesOnlyRunsAndSubmits(t *testing.T) {
	if c := parseCode([]byte(`{"type":"submit","language":"go","code":"x"}`)); c == nil || !c.submit || c.language != "go" {
		t.Fatalf("%+v", c)
	}
	for _, raw := range []string{`{"type":"answer","n":1}`, `not json`, `{"type":"run","code":7}`, `{}`} {
		if parseCode([]byte(raw)) != nil {
			t.Errorf("%s: taken", raw)
		}
	}
}
