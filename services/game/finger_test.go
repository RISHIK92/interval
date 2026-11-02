package main

import (
	"testing"
	"time"
)

// P3-W16-S05 (§6.3, Q-P3-24): fastest finger. Seven rounds of 15 s; each player answers
// once a round; the first right answer (on the server's clock, compensated) takes the
// round and ends it; most rounds taken wins, a tie to the lower time over the rounds
// each took, and equal is a draw.

func TestTheFirstRightAnswerTakesTheRoundAndEndsIt(t *testing.T) {
	a, clock, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	clock.Advance(2 * time.Second)
	a.answer("ada", 1, 0) // right (round 1's key is 0)
	settle(a)
	if m := bob.next(t); m["type"] != "locked" || m["player"] != "ada" {
		t.Fatalf("got %v", m)
	}
	if m := until(t, ada, "reveal"); m["taken"] != "ada" || m["correct"] != float64(0) ||
		m["totals"].(map[string]any)["ada"] != float64(1) {
		t.Fatalf("got %v", m)
	}
	// Bob's answer after the round was taken counts for nothing.
	a.answer("bob", 1, 0)
	settle(a)
	clock.Advance(revealPause)
	settle(a)
	if m := until(t, bob, "round"); m["n"] != float64(2) {
		t.Fatalf("got %v", m)
	}
}

func TestALockedAnswerSaysNothingOfItsCorrectness(t *testing.T) {
	a, _, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.answer("ada", 1, 2) // wrong
	settle(a)
	m := bob.next(t)
	if m["type"] != "locked" || len(m) != 2 {
		t.Fatalf("got %v", m)
	}
}

func TestAWrongAnswerLocksOutAndTheOtherCanStillTakeIt(t *testing.T) {
	a, clock, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.answer("ada", 1, 1) // wrong: locked out
	a.answer("ada", 1, 0) // a second answer: ignored
	settle(a)
	clock.Advance(4 * time.Second)
	a.answer("bob", 1, 0)
	settle(a)
	if m := until(t, ada, "reveal"); m["taken"] != "bob" {
		t.Fatalf("got %v", m)
	}
}

func TestBothWrongOrTheClockAndNobodyTakesIt(t *testing.T) {
	a, clock, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.answer("ada", 1, 1)
	a.answer("bob", 1, 2)
	settle(a)
	if m := until(t, ada, "reveal"); m["taken"] != "" {
		t.Fatalf("got %v", m)
	}
	settle(a)
	clock.Advance(revealPause)
	settle(a)
	until(t, ada, "round")
	clock.Advance(roundTime)
	settle(a)
	if m := until(t, ada, "reveal"); m["n"] != float64(2) || m["taken"] != "" {
		t.Fatalf("got %v", m)
	}
}

// MATCH-5: two right answers already queued go to the one sooner on the server's
// clock less half its round trip, not to whichever the actor reads first.
func TestTwoRightAnswersGoToTheSoonerCompensated(t *testing.T) {
	a, clock, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.rtt("bob", 300*time.Millisecond) // 150 ms off
	settle(a)
	at := clock.Now()
	a.answerAt("ada", 1, 0, at.Add(1000*time.Millisecond))
	a.answerAt("bob", 1, 0, at.Add(1100*time.Millisecond)) // 950 ms compensated
	settle(a)
	if m := until(t, ada, "reveal"); m["taken"] != "bob" {
		t.Fatalf("got %v", m)
	}
}

// Plays rounds 1..7, each taken by the given player after the given time (empty:
// nobody), and returns the final.
func playTakes(t *testing.T, takes []string, after []time.Duration) map[string]any {
	t.Helper()
	a, clock, ada, bob := startActor(t, sevenRounds())
	for i := range 7 {
		n := i + 1
		until(t, ada, "round")
		until(t, bob, "round")
		clock.Advance(after[i])
		if takes[i] != "" {
			a.answer(takes[i], n, i%4)
			settle(a)
		} else {
			settle(a)
			clock.Advance(roundTime)
			settle(a)
		}
		until(t, ada, "reveal")
		until(t, bob, "reveal")
		settle(a)
		clock.Advance(revealPause)
		settle(a)
	}
	until(t, bob, "final")
	return until(t, ada, "final")
}

func TestMostRoundsTakenWins(t *testing.T) {
	s := time.Second
	final := playTakes(t,
		[]string{"bob", "bob", "ada", "ada", "ada", "", "bob"},
		[]time.Duration{s, s, 9 * s, 9 * s, 9 * s, 0, s})
	if final["winner"] != "ada" && final["winner"] != "bob" {
		t.Fatalf("got %v", final)
	}
	totals := final["totals"].(map[string]any)
	if totals["ada"] != float64(3) || totals["bob"] != float64(3) {
		t.Fatalf("totals: %v", totals)
	}
	// 3–3: Bob took his in 3 s in all, Ada hers in 27 s.
	if final["winner"] != "bob" {
		t.Fatalf("the tie went to %v", final["winner"])
	}
	final = playTakes(t,
		[]string{"ada", "ada", "ada", "ada", "bob", "", ""},
		[]time.Duration{9 * s, 9 * s, 9 * s, 9 * s, s, 0, 0})
	if final["winner"] != "ada" {
		t.Fatalf("got %v", final)
	}
}

func TestEqualRoundsInEqualTimeIsADraw(t *testing.T) {
	s := time.Second
	final := playTakes(t,
		[]string{"ada", "bob", "ada", "bob", "", "", ""},
		[]time.Duration{2 * s, 2 * s, 3 * s, 3 * s, 0, 0, 0})
	if final["winner"] != "" {
		t.Fatalf("got %v", final)
	}
}

func TestARoundsMatchStartsWithACountdown(t *testing.T) {
	clock := newFakeClock()
	a := newActor("m", sevenRounds(), clock, nil)
	go a.run()
	t.Cleanup(a.stop)
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	if m := ada.next(t); m["type"] != "countdown" || m["seconds"] != float64(3) {
		t.Fatalf("got %v", m)
	}
	a.answer("ada", 1, 0) // before round 1: ignored
	settle(a)
	clock.Advance(countdownTime)
	settle(a)
	if m := ada.next(t); m["type"] != "round" || m["n"] != float64(1) {
		t.Fatalf("got %v", m)
	}
}

// Q-P3-24: a sprint both players have finished ends then, not at 60 s.
func TestASprintBothFinishEndsAtOnce(t *testing.T) {
	a, _, ada, bob := startSprint(t, sprintDef(2))
	for _, p := range []string{"ada", "bob"} {
		a.answer(p, 1, 0)
		a.answer(p, 2, 1)
	}
	settle(a)
	if final := until(t, ada, "final"); final["winner"] != "" {
		t.Fatalf("got %v", final) // equal counts at equal times
	}
	until(t, bob, "final")
}

// A rejoin mid-round after answering gets where it stands and the round again, locked in.
func TestARejoinAfterAnsweringGetsTheRoundLockedIn(t *testing.T) {
	a, _, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	a.answer("bob", 1, 1) // wrong: the round plays on
	a.leave("bob", bob)
	settle(a)
	back := newFakeSeat()
	a.join("bob", back)
	settle(a)
	m := back.next(t)
	if m["type"] != "resume" || m["answered"] != true || len(m["locked"].([]any)) != 1 {
		t.Fatalf("got %v", m)
	}
	if r := back.next(t); r["type"] != "round" || r["n"] != float64(1) {
		t.Fatalf("got %v", r)
	}
}

func TestARejoinDuringTheRoundsCountdownGetsTheCountdown(t *testing.T) {
	clock := newFakeClock()
	a := newActor("m", sevenRounds(), clock, nil)
	go a.run()
	t.Cleanup(a.stop)
	ada, bob := newFakeSeat(), newFakeSeat()
	a.join("ada", ada)
	a.join("bob", bob)
	ada.next(t)
	clock.Advance(time.Second)
	again := newFakeSeat()
	a.join("ada", again)
	settle(a)
	if m := again.next(t); m["type"] != "countdown" || m["seconds"] != float64(2) {
		t.Fatalf("got %v", m)
	}
}

// Two right answers at the same compensated time: the one read first takes it, whatever
// the seat order.
func TestEqualTimesGoToTheAnswerReadFirst(t *testing.T) {
	a, clock, ada, bob := startActor(t, sevenRounds())
	ada.next(t)
	bob.next(t)
	at := clock.Now().Add(time.Second)
	a.answerAt("bob", 1, 0, at)
	a.answerAt("ada", 1, 0, at)
	settle(a)
	if m := until(t, ada, "reveal"); m["taken"] != "bob" {
		t.Fatalf("got %v", m)
	}
}
