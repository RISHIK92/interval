package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"
)

// P5-W31-S02b (§6.5, Q-P5-15): a battle as handed over, and how it's scored.

func battleJSON(t *testing.T, edit func(m map[string]any)) []byte {
	t.Helper()
	file := map[string]any{"name": "main.py", "content": "harness"}
	scenario := func(layer string) map[string]any {
		return map[string]any{"layer": layer, "stdin": `{"calls":[]}`, "expected": []any{map[string]any{"call": 0, "value": nil}}}
	}
	battle := map[string]any{
		"problem": "lru-cache",
		"limits":  map[string]any{"seconds": 5, "memoryMB": 128},
		"checks":  []any{},
		"languages": map[string]any{
			"python": map[string]any{"solution": "solution.py", "base": []any{file}, "extension": []any{file}},
		},
		"scenarios": []any{scenario("visible"), scenario("hidden"), scenario("hidden"), scenario("concurrency"), scenario("extension")},
		"extension": map[string]any{"statement": "# More", "starters": map[string]any{"python": "class Box: ..."}},
	}
	m := map[string]any{"players": []any{"ada", "bob"}, "mode": "battle", "rounds": []any{}, "battle": battle}
	if edit != nil {
		edit(m)
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestParseMatchTakesAWholeBattle(t *testing.T) {
	def, err := parseMatch(battleJSON(t, nil))
	if err != nil || def.Battle == nil || len(def.Battle.Scenarios) != 5 {
		t.Fatalf("%v %+v", err, def)
	}
	battle := func(m map[string]any) map[string]any { return m["battle"].(map[string]any) }
	for name, edit := range map[string]func(map[string]any){
		"a battle with quiz rounds": func(m map[string]any) {
			m["rounds"] = []any{map[string]any{"question": 1, "stem": "?", "options": []any{"a", "b"}, "correct": 0}}
		},
		"battle mode without a battle": func(m map[string]any) { delete(m, "battle") },
		"a battle in another mode":     func(m map[string]any) { m["mode"] = "" },
		"no languages":                 func(m map[string]any) { battle(m)["languages"] = map[string]any{} },
		"a scenario in no layer": func(m map[string]any) {
			battle(m)["scenarios"] = []any{map[string]any{"layer": "secret", "stdin": "x", "expected": []any{1}}}
		},
		"a scenario without its results": func(m map[string]any) {
			battle(m)["scenarios"] = []any{map[string]any{"layer": "visible", "stdin": "x", "expected": []any{}}}
		},
		"no visible scenario": func(m map[string]any) {
			battle(m)["scenarios"] = []any{map[string]any{"layer": "hidden", "stdin": "x", "expected": []any{1}}}
		},
		"no extension harness": func(m map[string]any) {
			battle(m)["languages"] = map[string]any{"python": map[string]any{"solution": "solution.py", "base": []any{map[string]any{"name": "m", "content": "c"}}}}
		},
		"no limits": func(m map[string]any) { battle(m)["limits"] = map[string]any{} },
	} {
		if _, err := parseMatch(battleJSON(t, edit)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestBattleScoreWeighsLayers(t *testing.T) {
	def, err := parseMatch(battleJSON(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	b := def.Battle
	// visible 10, hidden 40 (20 each), concurrency 20, extension 30.
	for _, c := range []struct {
		passed []bool
		want   int
	}{
		{[]bool{true, true, true, true, true}, 1000},
		{[]bool{false, false, false, false, false}, 0},
		{[]bool{true, false, false, false, false}, 100},
		{[]bool{false, true, false, false, false}, 200},
		{[]bool{true, true, true, true, false}, 700}, // everything before the reveal
		{[]bool{false, false, false, false, true}, 300},
	} {
		if got := b.score(c.passed); got != c.want {
			t.Errorf("%v: %d, want %d", c.passed, got, c.want)
		}
	}
	// A problem without a concurrency layer: the rest are scaled to the full points.
	b.Scenarios = []battleScenario{b.Scenarios[0], b.Scenarios[1], b.Scenarios[4]}
	if got := b.score([]bool{true, true, true}); got != 1000 {
		t.Errorf("all passed, no concurrency layer: %d", got)
	}
	if got := b.score([]bool{true, false, false}); got != 125 { // 10 of 80
		t.Errorf("visible only, no concurrency layer: %d", got)
	}
}

func TestBestSubmissionCounts(t *testing.T) {
	var best bestSubmission
	best = best.improvedBy(0, time.Minute)
	if !best.Made || best.At != time.Minute {
		t.Fatalf("the first submission counts, even at 0: %+v", best)
	}
	best = best.improvedBy(500, 5*time.Minute)
	best = best.improvedBy(400, 6*time.Minute) // worse: kept the better one
	best = best.improvedBy(500, 7*time.Minute) // equal: kept the earlier time
	if best.Points != 500 || best.At != 5*time.Minute {
		t.Fatalf("%+v", best)
	}
	if best = best.improvedBy(900, 40*time.Minute); best.Points != 900 || best.At != 40*time.Minute {
		t.Fatalf("%+v", best)
	}
}

// A server without VELOX_URL has no judge, so it serves no battles.
func TestBattlesNeedAJudge(t *testing.T) {
	def, err := parseMatch(battleJSON(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	g := newRegistry(newMemStore(map[string]matchDef{"b1": def}), realClock{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, err := g.get(context.Background(), "b1"); !errors.Is(err, errBattleNotServed) {
		t.Fatalf("got %v", err)
	}
}

// The web app's handoff (apps/web valkey-match-handoff.test.ts) writes this same file.
func TestParseMatchReadsTheWebAppsBattle(t *testing.T) {
	raw, err := os.ReadFile("testdata/battle.json")
	if err != nil {
		t.Fatal(err)
	}
	def, err := parseMatch(raw)
	if err != nil {
		t.Fatal(err)
	}
	b := def.Battle
	if b.Problem != "box" || b.Languages["python"].Extension[0].Content != "# extended harness" ||
		len(b.Scenarios) != 2 || *b.Checks[0].Compare != "unordered" {
		t.Fatalf("%+v", b)
	}
}

func TestBattleJobsJudgeEachLayerThroughItsHarness(t *testing.T) {
	def, err := parseMatch(battleJSON(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	b := def.Battle
	n := 0
	id := func() string { n++; return "00000000-0000-4000-8000-00000000000" + string(rune('0'+n)) }
	at := time.Date(2026, 11, 13, 10, 0, 0, 0, time.UTC)
	base := func(s battleScenario) bool { return s.Layer != "extension" }
	all := func(battleScenario) bool { return true }
	before := b.jobs("python", "code", base, "ranked", at, id)
	if len(before) != 1 || len(before[0].scenarios) != 4 {
		t.Fatalf("before the reveal: the base layers only, %+v", before)
	}
	after := b.jobs("python", "code", all, "ranked", at, id)
	if len(after) != 2 || len(after[1].scenarios) != 1 || after[1].scenarios[0] != 4 {
		t.Fatalf("after the reveal: base, then the extension, %+v", after)
	}
	files := after[1].job.Files
	if *files[0].Name != "solution.py" || *files[0].Content != "code" || *files[1].Content != "harness" {
		t.Fatalf("the solution, then the extension's harness: %+v", files)
	}
	for _, j := range after {
		if err := j.job.Validate(); err != nil {
			t.Fatal(err)
		}
		for _, r := range j.job.Runs {
			if r.ReturnOutput != nil {
				t.Fatal("a run returns its output (LLDQ-4)")
			}
		}
	}
	// A large problem: no job past the judge's 100 runs.
	many := make([]battleScenario, 0, 230)
	for range 230 {
		many = append(many, b.Scenarios[1])
	}
	b.Scenarios = append([]battleScenario{b.Scenarios[0]}, many...)
	sizes := []int{}
	for _, j := range b.jobs("python", "code", all, "ranked", at, id) {
		sizes = append(sizes, len(j.job.Runs))
	}
	if len(sizes) != 3 || sizes[0] != 100 || sizes[1] != 100 || sizes[2] != 31 {
		t.Fatalf("chunks: %v", sizes)
	}
}

func TestParseMatchHoldsABattleToTheJudgeContract(t *testing.T) {
	battle := func(m map[string]any) map[string]any { return m["battle"].(map[string]any) }
	file := map[string]any{"name": "main.py", "content": "harness"}
	for name, edit := range map[string]func(map[string]any){
		"a language the judge doesn't run": func(m map[string]any) {
			battle(m)["languages"] = map[string]any{"cobol": map[string]any{"solution": "s.cob", "base": []any{file}, "extension": []any{file}}}
		},
		"a harness named as the solution": func(m map[string]any) {
			battle(m)["languages"] = map[string]any{"python": map[string]any{"solution": "main.py", "base": []any{file}, "extension": []any{file}}}
		},
		"a result line outside the contract": func(m map[string]any) {
			battle(m)["scenarios"] = []any{map[string]any{"layer": "visible", "stdin": "{}", "expected": []any{map[string]any{"call": -1, "value": 1}}}}
		},
		"a check outside the contract": func(m map[string]any) {
			battle(m)["checks"] = []any{map[string]any{"method": "items", "compare": "sorted"}}
		},
		"limits outside the contract": func(m map[string]any) { battle(m)["limits"] = map[string]any{"seconds": 99, "memoryMB": 128} },
	} {
		if _, err := parseMatch(battleJSON(t, edit)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
