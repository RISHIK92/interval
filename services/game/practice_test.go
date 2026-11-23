package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// ADR-0048 (Q-WD-28): LLD practice is a practice battle: one player, no clock but a
// 60-minute session, the extension on request, unrated, no fair-play signals, a progress
// message after each judged Submit, and daily caps kept in Valkey.

func practiceEdit(m map[string]any) {
	m["players"] = []any{"ada"}
	m["battle"].(map[string]any)["practice"] = true
}

// A practice battle on a fake clock, its one player seated and shown its start.
func startPractice(t *testing.T, edits ...func(m map[string]any)) (*actor, *fakeClock, *memStore, *fakeSeat) {
	t.Helper()
	def, err := parseMatch(battleJSON(t, func(m map[string]any) {
		practiceEdit(m)
		for _, edit := range edits {
			edit(m)
		}
	}))
	if err != nil {
		t.Fatal(err)
	}
	store := newMemStore(map[string]matchDef{"p1": def})
	clock := newFakeClock()
	a := newActor("p1", def, clock, nil)
	a.judge = fakeJudge{release: release}
	wire(a, store)
	go a.run()
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	if m := ada.next(t); m["type"] != "battle" || m["practice"] != true || m["revealed"] != false || m["extension"] != nil {
		t.Fatalf("the session's start: %v", m)
	}
	return a, clock, store, ada
}

// The actor's hand-offs, into the in-memory store.
func wire(a *actor, store *memStore) {
	a.save = func(s snap) { _ = store.save(context.Background(), a.id, s) }
	a.publish = func(r result) {
		raw, _ := json.Marshal(r)
		_ = store.publish(context.Background(), a.id, raw)
	}
	a.progress = func(p practiceJudged) {
		raw, _ := json.Marshal(p)
		_ = store.publishPractice(context.Background(), raw)
	}
	a.limits = store
}

func TestParseMatchTakesAPracticeBattleForOnePlayerOnly(t *testing.T) {
	def, err := parseMatch(battleJSON(t, practiceEdit))
	if err != nil || !def.Battle.Practice {
		t.Fatalf("%v %+v", err, def.Battle)
	}
	for name, edit := range map[string]func(map[string]any){
		"two players": func(m map[string]any) {
			practiceEdit(m)
			m["players"] = []any{"ada", "bob"}
		},
		"the AI mode": func(m map[string]any) {
			practiceEdit(m)
			m["battle"].(map[string]any)["battle_mode"] = "ai"
		},
	} {
		if _, err := parseMatch(battleJSON(t, edit)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// A practice problem may have no extension round.
	if _, err := parseMatch(battleJSON(t, func(m map[string]any) {
		practiceEdit(m)
		b := m["battle"].(map[string]any)
		delete(b, "extension")
		b["scenarios"] = b["scenarios"].([]any)[:4]
	})); err != nil {
		t.Fatalf("no extension: %v", err)
	}
}

func TestPracticeNeverRevealsOrEndsOnTheBattleClock(t *testing.T) {
	a, clock, store, ada := startPractice(t)
	clock.Advance(battleLength + time.Minute)
	settle(a)
	// Past 45:00 code is still judged, and on the base layers only: nothing was revealed.
	send(a, clock, "ada", "submit", "perfect")
	sub := nextOf(t, ada, "submitted")
	if sub["points"] != float64(700) || sub["layers"].(map[string]any)["extension"] != nil {
		t.Fatalf("no reveal on the clock: %v", sub)
	}
	if len(store.results()) != 0 {
		t.Fatalf("ended on the battle clock: %+v", store.results())
	}
	// The session's cap: 60 minutes, then the ordinary result, finished.
	settle(a)
	clock.Advance(practiceLength - battleLength - time.Minute)
	nextOf(t, ada, "final")
	r := resultOf(t, store)
	if r.Outcome != "finished" || len(r.Players) != 1 || r.Players[0].Total != 700 || r.Players[0].Abandoned ||
		r.Players[0].Best != nil { // no AI code review of practice
		t.Fatalf("the result: %+v", r)
	}
}

func TestTheExtensionIsRevealedOnRequestInPracticeOnly(t *testing.T) {
	a, clock, _, ada := startPractice(t)
	a.reveal("ada")
	m := nextOf(t, ada, "extension")
	if m["statement"] != "# More" || m["starters"].(map[string]any)["python"] != "class Box: ..." {
		t.Fatalf("the reveal: %v", m)
	}
	send(a, clock, "ada", "submit", "perfect")
	if sub := nextOf(t, ada, "submitted"); sub["points"] != float64(1000) {
		t.Fatalf("judged with the extension: %v", sub)
	}

	// In a battle, a reveal message changes nothing.
	b, bclock, _, bada, _ := startBattle(t)
	b.reveal("ada")
	settle(b)
	send(b, bclock, "ada", "submit", "perfect")
	if sub := nextOf(t, bada, "submitted"); sub["points"] != float64(700) {
		t.Fatalf("a battle's reveal is the clock's: %v", sub)
	}
}

func TestPracticeRevealOfAProblemWithoutAnExtensionIsIgnored(t *testing.T) {
	a, clock, _, ada := startPractice(t, func(m map[string]any) {
		b := m["battle"].(map[string]any)
		delete(b, "extension")
		b["scenarios"] = b["scenarios"].([]any)[:4]
	})
	a.reveal("ada")
	settle(a)
	send(a, clock, "ada", "submit", "perfect")
	if sub := nextOf(t, ada, "submitted"); sub["points"] != float64(1000) {
		t.Fatalf("%v", sub)
	}
}

func TestEachJudgedSubmitPublishesOneProgressMessage(t *testing.T) {
	a, clock, store, ada := startPractice(t)
	send(a, clock, "ada", "run", "perfect") // a Run publishes nothing
	nextOf(t, ada, "ran")
	settle(a)
	send(a, clock, "ada", "submit", "none")
	nextOf(t, ada, "submitted")
	settle(a)
	clock.Advance(submitCooldown)
	send(a, clock, "ada", "submit", "error") // the judge failed: nothing to publish
	nextOf(t, ada, "judge_error")
	settle(a)
	a.reveal("ada")
	send(a, clock, "ada", "submit", "perfect")
	nextOf(t, ada, "submitted")
	settle(a)
	got := store.progress()
	if len(got) != 2 {
		t.Fatalf("%d progress messages: %+v", len(got), got)
	}
	first, second := got[0], got[1]
	if first.MatchID != "p1" || first.Seq != 1 || first.User != "ada" || first.Problem != "lru-cache" ||
		first.Points != 0 || first.Language != "python" || first.Layers["hidden"]["total"] != 2 {
		t.Fatalf("first: %+v", first)
	}
	if _, ok := first.Layers["extension"]; ok {
		t.Fatalf("before the reveal, no extension layer: %+v", first)
	}
	if second.Seq != 2 || second.Points != 1000 || second.Layers["extension"]["passed"] != 1 {
		t.Fatalf("second: %+v", second)
	}
	if at, err := time.Parse(time.RFC3339, second.At); err != nil || at.Before(clock.Now().Add(-time.Hour)) {
		t.Fatalf("at: %q %v", second.At, err)
	}
}

func TestPracticeRaisesNoFairPlaySignals(t *testing.T) {
	a, clock, store, ada := startPractice(t)
	t0 := clock.Now()
	sendSignal(a, "ada", "focus", 0, t0.Add(time.Minute))
	sendSignal(a, "ada", "back", 0, t0.Add(5*time.Minute))
	sendSignal(a, "ada", "paste", 900, t0.Add(6*time.Minute))
	send(a, clock, "ada", "submit", "perfect")
	nextOf(t, ada, "submitted")
	settle(a)
	clock.Advance(practiceLength)
	nextOf(t, ada, "final")
	resultOf(t, store)
	if got := signalsOf(t, store, "ada"); len(got) != 0 {
		t.Fatalf("signals in practice: %+v", got)
	}
}

func TestPracticeEndsWhenThePlayerIsAwayPastTheGrace(t *testing.T) {
	a, clock, store, ada := startPractice(t)
	a.leave("ada", ada)
	settle(a)
	clock.Advance(grace)
	r := resultOf(t, store)
	if r.Outcome != "finished" || r.Players[0].Abandoned {
		t.Fatalf("a practice session just ends: %+v", r)
	}
}

func TestPracticeRestartsWithItsSequenceAndReveal(t *testing.T) {
	def, err := parseMatch(battleJSON(t, practiceEdit))
	if err != nil {
		t.Fatal(err)
	}
	clock := newFakeClock()
	store := newMemStore(map[string]matchDef{"p1": def})
	a := newActor("p1", def, clock, nil)
	a.judge = fakeJudge{}
	wire(a, store)
	a.from = &snap{Started: clock.Now().Add(-50 * time.Minute), Seq: 4, Revealed: true,
		Totals: map[string]int{"ada": 300}, Times: map[string]time.Duration{"ada": time.Minute}}
	go a.run()
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	if m := ada.next(t); m["revealed"] != true || m["seconds"] != float64(10*60) {
		t.Fatalf("ten minutes left, revealed: %v", m)
	}
	send(a, clock, "ada", "submit", "perfect")
	nextOf(t, ada, "submitted")
	settle(a)
	if got := store.progress(); len(got) != 1 || got[0].Seq != 5 || got[0].Points != 1000 {
		t.Fatalf("%+v", got)
	}
}

func TestPracticeDailyCapsRefuseWithStableCodes(t *testing.T) {
	a, clock, store, ada := startPractice(t)
	day := clock.Now().UTC().Format(time.DateOnly)
	store.counts["practice:runs:ada:"+day] = practiceRunsPerDay
	send(a, clock, "ada", "run", "perfect")
	if r := nextOf(t, ada, "refused"); r["code"] != "daily_runs" || r["submit"] != false {
		t.Fatalf("%v", r)
	}
	store.counts["practice:psubs:ada:lru-cache:"+day] = practiceSubmitsPerProblem
	send(a, clock, "ada", "submit", "perfect")
	if r := nextOf(t, ada, "refused"); r["code"] != "daily_problem_submits" {
		t.Fatalf("%v", r)
	}
	// A refusal spends neither the cooldown nor a count.
	if store.counts["practice:subs:ada:"+day] != 0 {
		t.Fatalf("counted: %v", store.counts)
	}
	store.counts["practice:psubs:ada:lru-cache:"+day] = 0
	store.counts["practice:subs:ada:"+day] = practiceSubmitsPerDay
	send(a, clock, "ada", "submit", "perfect")
	if r := nextOf(t, ada, "refused"); r["code"] != "daily_submits" {
		t.Fatalf("%v", r)
	}
	store.counts["practice:subs:ada:"+day] = 0
	send(a, clock, "ada", "submit", "perfect")
	nextOf(t, ada, "submitted")
	if store.counts["practice:subs:ada:"+day] != 1 || store.counts["practice:psubs:ada:lru-cache:"+day] != 1 {
		t.Fatalf("counted once each: %v", store.counts)
	}
}

func TestPracticeLimitsDownRefuseRatherThanJudge(t *testing.T) {
	a, clock, store, ada := startPractice(t)
	store.failLimits = true
	send(a, clock, "ada", "submit", "perfect")
	if r := nextOf(t, ada, "refused"); r["code"] != "unavailable" {
		t.Fatalf("%v", r)
	}
}

// The message the worker validates (workers/jobs/tests/test_practice.py reads this file).
// Regenerate with UPDATE_GOLDEN=1 go test -run Golden.
func TestTheProgressMessageMatchesItsGoldenFile(t *testing.T) {
	p := practiceJudged{
		MatchID: "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b", Seq: 3, User: "user-1", Problem: "lru-cache",
		Points: 820, Language: "python", At: "2026-11-23T12:05:00Z",
		Layers: map[string]map[string]int{
			"visible":     {"passed": 1, "total": 1},
			"hidden":      {"passed": 9, "total": 10},
			"concurrency": {"passed": 1, "total": 2},
			"extension":   {"passed": 2, "total": 3},
		},
	}
	got, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	got = append(got, '\n')
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile("testdata/practice_judged.json", got, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile("testdata/practice_judged.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("the progress message's shape changed:\n%s\nwant:\n%s", got, want)
	}
}

// The caps against a real Valkey, when one is configured (VALKEY_URL).
func TestRedisPracticeLimitsCountAndRefuse(t *testing.T) {
	url := os.Getenv("VALKEY_URL")
	if url == "" {
		t.Skip("no VALKEY_URL")
	}
	options, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	store := redisStore{redis.NewClient(options)}
	t.Cleanup(func() { _ = store.client.Close() })
	ctx := context.Background()
	user := "practice-test-" + newUUID()
	at := time.Date(2026, 11, 23, 23, 59, 0, 0, time.UTC)
	keys := []string{"practice:runs:" + user + ":2026-11-23", "practice:subs:" + user + ":2026-11-23", "practice:psubs:" + user + ":lru-cache:2026-11-23"}
	t.Cleanup(func() { store.client.Del(ctx, keys...) })
	for i := range practiceRunsPerDay {
		if code, err := store.takePractice(ctx, user, "lru-cache", false, at); err != nil || code != "" {
			t.Fatalf("run %d: %q %v", i, code, err)
		}
	}
	if code, _ := store.takePractice(ctx, user, "lru-cache", false, at); code != "daily_runs" {
		t.Fatalf("run past the cap: %q", code)
	}
	for i := range practiceSubmitsPerProblem {
		if code, err := store.takePractice(ctx, user, "lru-cache", true, at); err != nil || code != "" {
			t.Fatalf("submit %d: %q %v", i, code, err)
		}
	}
	if code, _ := store.takePractice(ctx, user, "lru-cache", true, at); code != "daily_problem_submits" {
		t.Fatalf("submit past the problem's cap: %q", code)
	}
	if n, _ := store.client.Get(ctx, keys[1]).Int(); n != practiceSubmitsPerProblem {
		t.Fatalf("a refusal counted: %d", n)
	}
	if ttl := store.client.TTL(ctx, keys[1]).Val(); ttl <= 24*time.Hour || ttl > 48*time.Hour {
		t.Fatalf("ttl %v", ttl)
	}
}

// A user id with a colon can't make its daily count land on another's per-problem one.
func TestPracticeCountersHaveDistinctPrefixes(t *testing.T) {
	at := time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC)
	daily := practiceCounters("ada:lru-cache", "x", true, at)[0].key
	perProblem := practiceCounters("ada", "lru-cache", true, at)[1].key
	if daily == perProblem || !strings.HasPrefix(perProblem, "practice:psubs:") {
		t.Fatalf("%q and %q", daily, perProblem)
	}
}

// A practice session through the registry, as the server runs it, and its log.
func practiceThroughRegistry(t *testing.T, store *memStore) (*actor, *fakeClock, *fakeSeat, *syncLog) {
	t.Helper()
	def, err := parseMatch(battleJSON(t, practiceEdit))
	if err != nil {
		t.Fatal(err)
	}
	store.defs["p1"] = def
	logs := &syncLog{}
	clock := newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.NewJSONHandler(logs, nil)))
	g.judge = fakeJudge{}
	a, err := g.get(context.Background(), "p1")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	ada.next(t)
	return a, clock, ada, logs
}

// A log written from more than one goroutine.
type syncLog struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *syncLog) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *syncLog) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

// LOAD-5: a practice snapshot carries the sequence number, so it is tried as often as an
// "over" one; lost, a restart would send that number again and the worker drop it.
func TestAPracticeSnapshotIsTriedThrice(t *testing.T) {
	store := newMemStore(map[string]matchDef{})
	store.fail = true
	a, clock, ada, logs := practiceThroughRegistry(t, store)
	send(a, clock, "ada", "submit", "perfect")
	nextOf(t, ada, "submitted")
	settle(a)
	if !strings.Contains(logs.String(), `"msg":"game: snapshot failed","match":"p1","over":false,"try":3`) {
		t.Fatalf("not tried thrice:\n%s", logs)
	}
}

// The progress hand-off retries off the actor: play goes on while Valkey is down.
func TestPracticeProgressIsHandedOverOffTheActor(t *testing.T) {
	store := newMemStore(map[string]matchDef{})
	store.failPractice = true
	a, clock, ada, logs := practiceThroughRegistry(t, store)
	start := time.Now()
	send(a, clock, "ada", "submit", "perfect")
	nextOf(t, ada, "submitted")
	settle(a)
	if waited := time.Since(start); waited > 500*time.Millisecond {
		t.Fatalf("the actor waited %v on the hand-off", waited)
	}
	deadline := time.Now().Add(5 * time.Second)
	for strings.Count(logs.String(), `"msg":"game: practice progress not handed over"`) < 3 {
		if time.Now().After(deadline) {
			t.Fatalf("not tried thrice:\n%s", logs)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
