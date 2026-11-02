package main

import (
	"context"
	"log/slog"
	"testing"
	"time"
)

// P3-W16-S04 (§6.3, Q-P3-23): a live sprint. After a 3 s countdown both players work
// through the same 30 questions at their own pace for 60 s; most correct wins, a tie
// goes to whoever reached that total first. Only right or wrong is told before the end.

func sprintDef(n int) matchDef {
	def := matchDef{Players: []string{"ada", "bob"}, Mode: sprintMode}
	for i := range n {
		def.Rounds = append(def.Rounds, round{
			Question: int64(200 + i),
			Stem:     "Which?",
			Options:  []string{"w", "x", "y", "z"},
			Correct:  i % 4,
		})
	}
	return def
}

// Reads past other messages to the first of this type.
func until(t *testing.T, s *fakeSeat, kind string) map[string]any {
	t.Helper()
	for {
		if m := s.next(t); m["type"] == kind {
			return m
		}
	}
}

// Starts a sprint and plays its countdown: both players are on question 1.
func startSprint(t *testing.T, def matchDef) (*actor, *fakeClock, *fakeSeat, *fakeSeat) {
	t.Helper()
	a, clock, ada, bob := startActor(t, def)
	for _, s := range []*fakeSeat{ada, bob} {
		if m := s.next(t); m["type"] != "countdown" || m["seconds"] != float64(3) {
			t.Fatalf("got %v", m)
		}
	}
	settle(a)
	clock.Advance(countdownTime)
	settle(a)
	for _, s := range []*fakeSeat{ada, bob} {
		if m := s.next(t); m["type"] != "start" || m["seconds"] != float64(60) {
			t.Fatalf("got %v", m)
		}
		q := s.next(t)
		if q["type"] != "question" || q["n"] != float64(1) || q["stem"] != "Which?" {
			t.Fatalf("got %v", q)
		}
		if _, leaked := q["correct"]; leaked {
			t.Fatalf("a question sent its key: %v", q)
		}
	}
	return a, clock, ada, bob
}

func TestASprintPlaysAtEachPlayersOwnPace(t *testing.T) {
	a, clock, ada, bob := startSprint(t, sprintDef(30))
	clock.Advance(2 * time.Second)
	a.answer("ada", 1, 0) // right
	settle(a)
	if m := ada.next(t); m["type"] != "judged" || m["n"] != float64(1) || m["correct"] != true {
		t.Fatalf("got %v", m)
	}
	if m := ada.next(t); m["type"] != "score" || m["correct"].(map[string]any)["ada"] != float64(1) {
		t.Fatalf("got %v", m)
	}
	q := ada.next(t)
	if q["type"] != "question" || q["n"] != float64(2) {
		t.Fatalf("got %v", q)
	}
	if _, leaked := q["correct"]; leaked {
		t.Fatalf("a question sent its key: %v", q)
	}
	// Bob is told the score, and is still on question 1.
	if m := bob.next(t); m["type"] != "score" {
		t.Fatalf("got %v", m)
	}
	a.answer("bob", 2, 1) // not his question: ignored
	a.answer("bob", 1, 3) // wrong
	settle(a)
	if m := bob.next(t); m["type"] != "judged" || m["correct"] != false {
		t.Fatalf("got %v", m)
	}
	if _, leaked := until(t, bob, "question")["correct"]; leaked {
		t.Fatal("a key leaked")
	}
}

func TestOnlyTheCurrentQuestionARealChoiceAndAPlayerCount(t *testing.T) {
	a, _, ada, _ := startSprint(t, sprintDef(30))
	a.answer("ada", 1, 9) // no such choice
	a.answer("ada", 0, 0) // no such question
	a.answer("ada", 3, 0) // not hers yet
	a.answer("eve", 1, 0) // not a player
	a.answer("ada", 1, 0) // counts
	a.answer("ada", 1, 0) // already answered
	settle(a)
	if m := ada.next(t); m["type"] != "judged" || m["n"] != float64(1) {
		t.Fatalf("got %v", m)
	}
	until(t, ada, "question")
	select {
	case m := <-ada.out:
		t.Fatalf("an ignored answer was answered: %v", m)
	default:
	}
}

func TestAnswersBeforeTheStartAreIgnored(t *testing.T) {
	a, _, ada, _ := startActor(t, sprintDef(30))
	ada.next(t) // countdown
	a.answer("ada", 1, 0)
	settle(a)
	select {
	case m := <-ada.out:
		t.Fatalf("answered during the countdown: %v", m)
	default:
	}
}

func TestMostCorrectWinsAtSixtySeconds(t *testing.T) {
	a, clock, ada, bob := startSprint(t, sprintDef(30))
	a.answer("ada", 1, 0)
	a.answer("ada", 2, 1)
	a.answer("bob", 1, 0)
	a.answer("bob", 2, 0) // wrong
	settle(a)
	clock.Advance(sprintTime)
	settle(a)
	final := until(t, ada, "final")
	if final["winner"] != "ada" {
		t.Fatalf("got %v", final)
	}
	if totals := final["totals"].(map[string]any); totals["ada"] != float64(2) || totals["bob"] != float64(1) {
		t.Fatalf("totals: %v", totals)
	}
	// The review: every question either reached, keys included, and each one's answers.
	review := final["review"].(map[string]any)
	questions := review["questions"].([]any)
	if len(questions) != 3 {
		t.Fatalf("%d questions reviewed", len(questions))
	}
	if q := questions[1].(map[string]any); q["n"] != float64(2) || q["correct"] != float64(1) {
		t.Fatalf("got %v", q)
	}
	bobs := review["answers"].(map[string]any)["bob"].([]any)
	if len(bobs) != 2 || bobs[1].(map[string]any)["choice"] != float64(0) {
		t.Fatalf("got %v", bobs)
	}
	until(t, bob, "final")
}

func TestATieGoesToWhoeverReachedItFirst(t *testing.T) {
	a, clock, ada, bob := startSprint(t, sprintDef(30))
	clock.Advance(5 * time.Second)
	a.answer("bob", 1, 0)
	settle(a)
	clock.Advance(5 * time.Second)
	a.answer("ada", 1, 0)
	a.answer("bob", 2, 0) // wrong: his total was reached earlier
	settle(a)
	clock.Advance(sprintTime)
	settle(a)
	if final := until(t, ada, "final"); final["winner"] != "bob" {
		t.Fatalf("got %v", final)
	}
	until(t, bob, "final")
}

func TestNothingRightIsADraw(t *testing.T) {
	a, clock, ada, _ := startSprint(t, sprintDef(30))
	clock.Advance(sprintTime)
	settle(a)
	if final := until(t, ada, "final"); final["winner"] != "" {
		t.Fatalf("got %v", final)
	}
}

func TestNobodyAnsweringStillReviewsTheFirstQuestion(t *testing.T) {
	a, clock, ada, _ := startSprint(t, sprintDef(30))
	clock.Advance(sprintTime)
	settle(a)
	review := until(t, ada, "final")["review"].(map[string]any)
	if questions := review["questions"].([]any); len(questions) != 1 {
		t.Fatalf("%d questions reviewed", len(questions))
	}
}

func TestAnAnswerSentDuringTheCountdownNeverCounts(t *testing.T) {
	a, clock, ada, _ := startActor(t, sprintDef(30))
	ada.next(t)
	early := clock.Now()
	settle(a)
	clock.Advance(countdownTime)
	settle(a)
	a.answerAt("ada", 1, 0, early) // queued in the countdown, handled after the start
	settle(a)
	clock.Advance(sprintTime)
	settle(a)
	if final := until(t, ada, "final"); final["totals"].(map[string]any)["ada"] != float64(0) {
		t.Fatalf("got %v", final)
	}
}

func TestAnAnswerAfterSixtySecondsIsIgnored(t *testing.T) {
	a, clock, ada, _ := startSprint(t, sprintDef(30))
	clock.Advance(sprintTime + time.Second)
	a.answerAt("ada", 1, 0, clock.Now()) // arrived late, before the actor saw the end
	settle(a)
	final := until(t, ada, "final")
	if final["totals"].(map[string]any)["ada"] != float64(0) {
		t.Fatalf("got %v", final)
	}
}

func TestAPlayerWhoAnswersEveryQuestionWaits(t *testing.T) {
	a, clock, ada, _ := startSprint(t, sprintDef(3))
	for n := 1; n <= 3; n++ {
		a.answer("ada", n, (n-1)%4)
		settle(a)
		until(t, ada, "judged")
	}
	if m := until(t, ada, "done"); m["type"] != "done" {
		t.Fatalf("got %v", m)
	}
	clock.Advance(sprintTime)
	settle(a)
	if final := until(t, ada, "final"); final["winner"] != "ada" {
		t.Fatalf("got %v", final)
	}
}

func TestARejoinMidSprintGetsWhereItStands(t *testing.T) {
	a, clock, ada, _ := startSprint(t, sprintDef(30))
	a.answer("ada", 1, 0)
	settle(a)
	until(t, ada, "question")
	clock.Advance(20 * time.Second)
	again := newFakeSeat()
	a.join("ada", again)
	settle(a)
	m := again.next(t)
	if m["type"] != "resume" || m["seconds"] != float64(40) || m["correct"].(map[string]any)["ada"] != float64(1) {
		t.Fatalf("got %v", m)
	}
	if q := again.next(t); q["type"] != "question" || q["n"] != float64(2) {
		t.Fatalf("got %v", q)
	}
}

func TestARejoinDuringTheCountdownGetsTheCountdown(t *testing.T) {
	a, clock, ada, _ := startActor(t, sprintDef(30))
	ada.next(t)
	clock.Advance(time.Second)
	again := newFakeSeat()
	a.join("ada", again)
	settle(a)
	if m := again.next(t); m["type"] != "countdown" || m["seconds"] != float64(2) {
		t.Fatalf("got %v", m)
	}
}

// Owner, 2026-11-02: after a restart the interrupted round is played again from its
// start; a sprint is one round, so it starts over, countdown and all.
func TestASprintAfterARestartStartsOver(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sprintDef(30)})
	clock := newFakeClock()
	first := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	a, _ := first.get(context.Background(), "m")
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	settle(a)
	clock.Advance(countdownTime)
	settle(a)
	a.answer("ada", 1, 0)
	settle(a)
	first.stopAll()

	second := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	b, err := second.get(context.Background(), "m")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(b.stop)
	if b.from == nil {
		t.Fatal("the sprint left no restart point")
	}
	ada2, bob2 := newFakeSeat(), newFakeSeat()
	b.join("ada", ada2)
	b.join("bob", bob2)
	settle(b)
	if m := ada2.next(t); m["type"] != "countdown" {
		t.Fatalf("got %v", m)
	}
	clock.Advance(countdownTime)
	settle(b)
	until(t, ada2, "start")
	if q := ada2.next(t); q["n"] != float64(1) {
		t.Fatalf("got %v", q)
	}
	clock.Advance(sprintTime)
	settle(b)
	if final := until(t, ada2, "final"); final["totals"].(map[string]any)["ada"] != float64(0) {
		t.Fatalf("the earlier answer counted: %v", final)
	}
}

func TestASprintHandsItsResultOver(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": sprintDef(30)})
	clock := newFakeClock()
	a, ada, _ := registryWith(t, store, clock)
	settle(a)
	clock.Advance(countdownTime)
	settle(a)
	clock.Advance(1500 * time.Millisecond)
	a.answer("ada", 1, 0)
	a.answer("ada", 2, 3) // wrong
	settle(a)
	clock.Advance(sprintTime)
	settle(a)
	until(t, ada, "final")
	waitEnded(t, a)
	results := store.results()
	if len(results) != 1 || results[0].Outcome != "finished" || *results[0].Winner != "ada" {
		t.Fatalf("got %+v", results)
	}
	p := results[0].Players[0]
	if p.PlayedAs != "ada" || p.Total != 1 || p.TimeMs != 1500 || len(p.Answers) != 2 {
		t.Fatalf("got %+v", p)
	}
	if got := p.Answers[1]; got.Round != 2 || got.QuestionID != 201 || *got.Correct {
		t.Fatalf("got %+v", got)
	}
}

func TestAnUnknownModeIsRefused(t *testing.T) {
	if _, err := parseMatch([]byte(`{"players":["a"],"mode":"chess","rounds":[{"question":1,"stem":"s","options":["a","b"],"correct":0}]}`)); err == nil {
		t.Fatal("an unknown mode was taken")
	}
	def, err := parseMatch([]byte(`{"players":["a"],"mode":"sprint","rounds":[{"question":1,"stem":"s","options":["a","b"],"correct":0}]}`))
	if err != nil || def.Mode != sprintMode {
		t.Fatalf("got %v %v", def, err)
	}
}
