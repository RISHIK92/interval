package main

import (
	"slices"
	"time"
)

// P3-W17-S01 (BOT-1): a ghost's seat. What it is sent goes nowhere.
type ghostSeat struct{}

func (ghostSeat) send(any) bool { return true }
func (ghostSeat) close(string)  {}

// Posts the ghost's answers to questions from..to, each at its recorded time after
// `started` on the match's clock, judged then like anyone's. A sprint takes answers in
// question order only, and recorded times needn't rise with it (each was compensated by
// the round trip at the time), so they go in order, each no sooner than the one before.
// The timers are set here, in the actor, so they start with the round (or sprint); one
// goroutine posts them in order and ends with the match.
func (a *actor) ghostPlays(from, to int, started time.Time) {
	g := a.def.Ghost
	if g == nil {
		return
	}
	answers := slices.Clone(g.Answers)
	slices.SortStableFunc(answers, func(x, y ghostAnswer) int { return x.N - y.N })
	type due struct {
		lapse  <-chan time.Time
		answer ghostAnswer
		at     time.Time
	}
	var queue []due
	var last time.Duration
	for _, answer := range answers {
		if answer.N < from || answer.N > to {
			continue
		}
		last = max(last, time.Duration(answer.Ms)*time.Millisecond)
		queue = append(queue, due{a.clock.After(last), answer, started.Add(last)})
	}
	if len(queue) == 0 {
		return
	}
	go func() {
		for _, d := range queue {
			select {
			case <-d.lapse:
				a.answerAt(g.Player, d.answer.N, d.answer.Choice, d.at)
			case <-a.ended:
				return
			}
		}
	}()
}
