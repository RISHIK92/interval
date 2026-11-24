package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Q-WD-17 (owner, 2026-11-23; LLDQ-4): a failing visible test comes back with its name, a
// message and the line of the player's code, to that player only; a hidden test stays a
// count, whatever the judge says.

func TestOnlyVisibleRunsAreNamed(t *testing.T) {
	def, err := parseMatch(battleJSON(t, func(m map[string]any) {
		b := m["battle"].(map[string]any)
		s := b["scenarios"].([]any)
		// A second visible test, after the hidden ones: still "Test 2".
		b["scenarios"] = append(s, s[0])
	}))
	if err != nil {
		t.Fatal(err)
	}
	all := func(battleScenario) bool { return true }
	at := time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)
	names := map[string]int{}
	for _, j := range def.Battle.jobs("python", "code", all, "casual", at, func() string { return "00000000-0000-4000-8000-000000000001" }) {
		if err := j.job.Validate(); err != nil {
			t.Fatal(err)
		}
		for k, r := range j.job.Runs {
			layer := def.Battle.Scenarios[j.scenarios[k]].Layer
			switch {
			case layer == "visible" && r.Name != nil:
				names[*r.Name]++
			case layer == "visible":
				t.Fatal("a visible run without its name")
			case r.Name != nil:
				t.Fatalf("a %s run named %q (LLDQ-4)", layer, *r.Name)
			}
		}
	}
	if len(names) != 2 || names["Test 1"] != 1 || names["Test 2"] != 1 {
		t.Fatalf("%v", names)
	}
}

func TestAFailingVisibleTestSaysWhyToItsPlayerOnly(t *testing.T) {
	a, clock, _, ada, bob := startBattle(t)
	send(a, clock, "ada", "run", "explained")
	tests := nextOf(t, ada, "ran")["tests"].([]any)
	want := map[string]any{"passed": false, "verdict": "ok", "name": "Test 1", "message": "call 1 (get): expected 1, got 2 (secret)", "line": float64(14)}
	if len(tests) != 1 {
		t.Fatalf("%v", tests)
	}
	for k, v := range want {
		if tests[0].(map[string]any)[k] != v {
			t.Fatalf("%s: %v", k, tests[0])
		}
	}
	clock.Advance(time.Minute)
	send(a, clock, "ada", "submit", "explained")
	sub := nextOf(t, ada, "submitted")
	failures, _ := sub["failures"].([]any)
	if len(failures) != 1 {
		t.Fatalf("the visible test's failure only: %v", sub)
	}
	f := failures[0].(map[string]any)
	if f["name"] != "Test 1" || f["message"] != want["message"] || f["line"] != float64(14) {
		t.Fatalf("%v", f)
	}
	raw, _ := json.Marshal(sub)
	if strings.Contains(string(raw), "a hidden test") {
		t.Fatalf("a hidden test's failure reached the player (LLDQ-4): %s", raw)
	}
	// The opponent sees ada's best, never her failures.
	settle(a)
	for {
		select {
		case m := <-bob.out:
			raw, _ := json.Marshal(m)
			if strings.Contains(string(raw), "secret") || strings.Contains(string(raw), "Test 1") {
				t.Fatalf("the opponent was sent ada's failure: %s", raw)
			}
			continue
		default:
		}
		break
	}
}

func TestAPassingSubmitHasNoFailures(t *testing.T) {
	a, clock, _, ada, _ := startBattle(t)
	send(a, clock, "ada", "submit", "perfect")
	if sub := nextOf(t, ada, "submitted"); sub["failures"] != nil {
		t.Fatalf("%v", sub)
	}
	clock.Advance(time.Minute)
	send(a, clock, "ada", "run", "none")
	test := nextOf(t, ada, "ran")["tests"].([]any)[0].(map[string]any)
	// Failed without the judge saying why: the name, nothing more.
	if test["name"] != "Test 1" || test["message"] != nil || test["line"] != nil {
		t.Fatalf("%v", test)
	}
}
