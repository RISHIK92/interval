package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"interval/services/game/judge"
)

// P5-W31-S02b (§6.5, Q-P5-15; LLDQ-4): an LLD battle as the web app hands it over, beside
// a quiz match's rounds. It carries every scenario with its expected results, hidden
// ones included: like a quiz's keys, they never leave this process. Only the visible
// layer's scenarios are ever shown, and results by category.
const battleMode = "battle"

// Q-P5-15 (owner, 2026-11-12): 30 minutes on the base problem, then the extension is
// revealed to every player at once, with 15 minutes left.
const (
	battleReveal = 30 * time.Minute
	battleLength = 45 * time.Minute
)

type battleDef struct {
	Problem   string                    `json:"problem"`
	Limits    battleLimits              `json:"limits"`
	Checks    []judge.Check             `json:"checks"`
	Languages map[string]battleLanguage `json:"languages"`
	Scenarios []battleScenario          `json:"scenarios"`
	// P5-W31-S03: what players are shown at the reveal, and only then (the clock is this
	// server's): extension.md, and the extended interface's starter code per language.
	Extension *battleExtension `json:"extension,omitempty"`
}

type battleExtension struct {
	Statement string            `json:"statement"`
	Starters  map[string]string `json:"starters"`
}

type battleLimits struct {
	Seconds  int64 `json:"seconds"`
	MemoryMB int64 `json:"memoryMB"`
}

// The files a submission is judged with, per language: generated harnesses for the base
// interface and, after the reveal, for the extended one (W31-S02a), beside the player's
// solution file.
type battleLanguage struct {
	Solution  string       `json:"solution"`
	Base      []battleFile `json:"base"`
	Extension []battleFile `json:"extension"`
}

type battleFile struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// One scenario: its layer, what the harness reads, and the reference's results.
type battleScenario struct {
	Layer    string          `json:"layer"`
	Stdin    string          `json:"stdin"`
	Expected json.RawMessage `json:"expected"`
}

// Q-P5-15: each layer's share of a battle's points, split evenly across its scenarios.
var layerWeights = map[string]float64{
	"visible":     10,
	"hidden":      40,
	"concurrency": 20,
	"extension":   30,
}

const maxBattlePoints = 1000

const maxBattlePlayers = 4

// A judge job holds at most this many runs (packages/judge), and a problem up to 190
// scenarios: a submission is judged in jobs of this size.
const maxRunsPerJob = 100

// Checked by building every judge job a submission in each language would send (with a
// stand-in solution) and holding each to the judge contract: the language, files,
// limits, checks and every expected result line, here rather than at a player's first
// submit.
func (b *battleDef) validate() error {
	if b.Problem == "" || len(b.Languages) == 0 {
		return errors.New("a battle needs its problem and languages")
	}
	extension := false
	visible := false
	for _, s := range b.Scenarios {
		if _, ok := layerWeights[s.Layer]; !ok {
			return fmt.Errorf("a battle scenario in no layer: %q", s.Layer)
		}
		var expected []json.RawMessage
		if json.Unmarshal(s.Expected, &expected) != nil || len(expected) == 0 {
			return errors.New("a battle scenario without its expected results")
		}
		extension = extension || s.Layer == "extension"
		visible = visible || s.Layer == "visible"
	}
	if !visible {
		return errors.New("a battle needs visible scenarios")
	}
	if extension != (b.Extension != nil) {
		return errors.New("a battle's extension scenarios and its extension text go together")
	}
	if e := b.Extension; e != nil {
		if e.Statement == "" {
			return errors.New("a battle's extension without its statement")
		}
		for name := range b.Languages {
			if e.Starters[name] == "" {
				return fmt.Errorf("%s: no extension starter", name)
			}
		}
	}
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	stand := func() string { return "00000000-0000-4000-8000-000000000000" }
	for name, l := range b.Languages {
		if l.Solution == "" || len(l.Base) == 0 || (extension && len(l.Extension) == 0) {
			return fmt.Errorf("%s: a battle language without its harness files", name)
		}
		for _, f := range append(append([]battleFile{}, l.Base...), l.Extension...) {
			if f.Name == l.Solution {
				return fmt.Errorf("%s: a harness file named as the solution", name)
			}
		}
		all := func(battleScenario) bool { return true }
		for _, j := range b.jobs(name, "", all, "run", at, stand) {
			if err := j.job.Validate(); err != nil {
				return fmt.Errorf("%s: %w", name, err)
			}
		}
	}
	return nil
}

// One judge job of a submission, and which scenarios its runs are.
type battleJob struct {
	job       judge.JudgeJob
	scenarios []int
}

// The jobs that judge code in one language on the scenarios `include` picks: the base
// layers through the base interface's harness, the extension through the extended one,
// each at most maxRunsPerJob runs. Results go back by category only (LLDQ-4): no run
// returns its output.
func (b *battleDef) jobs(language, code string, include func(battleScenario) bool, priority string, at time.Time, newID func() string) []battleJob {
	l := b.Languages[language]
	var base, extension []int
	for i, s := range b.Scenarios {
		switch {
		case !include(s):
		case s.Layer != "extension":
			base = append(base, i)
		default:
			extension = append(extension, i)
		}
	}
	var out []battleJob
	for _, part := range []struct {
		harness   []battleFile
		scenarios []int
	}{{l.Base, base}, {l.Extension, extension}} {
		for start := 0; start < len(part.scenarios); start += maxRunsPerJob {
			ids := part.scenarios[start:min(start+maxRunsPerJob, len(part.scenarios))]
			files := []judge.File{{Name: &l.Solution, Content: &code}}
			for _, f := range part.harness {
				files = append(files, judge.File{Name: &f.Name, Content: &f.Content})
			}
			runs := make([]judge.Run, 0, len(ids))
			for _, i := range ids {
				s := b.Scenarios[i]
				var expected []judge.ResultLine
				_ = json.Unmarshal(s.Expected, &expected) // checked by validate
				runs = append(runs, judge.Run{Stdin: &s.Stdin, Expected: expected, Checks: b.Checks})
			}
			id, lang, submitted := newID(), language, at.UTC().Format(time.RFC3339)
			seconds, memory := b.Limits.Seconds, b.Limits.MemoryMB
			out = append(out, battleJob{
				job: judge.JudgeJob{
					Id: &id, Priority: &priority, Language: &lang, Files: files,
					Limits:      &judge.Limits{Seconds: &seconds, MemoryMB: &memory},
					Runs:        runs,
					SubmittedAt: &submitted,
				},
				scenarios: ids,
			})
		}
	}
	return out
}

// The points for a submission's results: passed[i] is whether scenario i passed. A
// layer with no scenarios drops out and the rest are scaled to the full points. A
// submission made before the reveal is never judged on the extension, so it scores 0
// there and at most 700: the extension's 30% (Q-P5-15) is only earned after the reveal,
// or a perfect base-only submission could never be beaten.
func (b *battleDef) score(passed []bool) int {
	count := map[string]int{}
	for _, s := range b.Scenarios {
		count[s.Layer]++
	}
	total := 0.0
	for layer, n := range count {
		if n > 0 {
			total += layerWeights[layer]
		}
	}
	got := 0.0
	for i, s := range b.Scenarios {
		if i < len(passed) && passed[i] {
			got += layerWeights[s.Layer] / float64(count[s.Layer])
		}
	}
	// total > 0: validate requires a visible scenario.
	return int(math.Round(got / total * maxBattlePoints))
}

// A player's best submission so far: the one that counts (Q-P5-15), its time the
// tiebreak. A later one replaces it only by scoring more, so an equal score keeps the
// earlier time.
type bestSubmission struct {
	Points int           `json:"points"`
	At     time.Duration `json:"at"` // since the battle began
	Made   bool          `json:"made"`
}

func (s bestSubmission) improvedBy(points int, at time.Duration) bestSubmission {
	if s.Made && points <= s.Points {
		return s
	}
	return bestSubmission{Points: points, At: at, Made: true}
}
