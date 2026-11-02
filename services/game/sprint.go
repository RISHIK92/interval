package main

import "time"

// P3-W16-S04 (§6.3, Q-P3-23; owner, 2026-11-03): the live 1v1 sprint. Both players get
// the same ordered questions and answer at their own pace for 60 s on this server's
// clock; most correct wins, a tie goes to whoever reached that total first. A player
// is told right or wrong only; the keys come with the final message.
const (
	sprintMode    = "sprint"
	countdownTime = 3 * time.Second
	sprintTime    = 60 * time.Second
)

type sprintRun struct {
	live  bool      // past the countdown
	over  bool      // the 60 s are up: late answers are still judged, nothing more is asked
	until time.Time // when the sprint ends
	start time.Time
	at    map[string]int // a player's questions answered: the next one is at+1
}

func (a *actor) sprint(p *play) {
	// A restart's snapshot carries no answers (the one saved here, at the start): the
	// interrupted sprint plays again from its countdown (owner, 2026-11-02).
	s := &sprintRun{at: map[string]int{}}
	p.sprint = s
	if !a.countdownFirst(p) {
		return
	}
	s.live, s.start = true, a.clock.Now()
	s.until = s.start.Add(sprintTime)
	end := a.clock.After(sprintTime)
	a.broadcast(p, map[string]any{"type": "start", "seconds": seconds(sprintTime)})
	for player, seat := range p.seats {
		a.tell(p, player, seat, a.nextFor(p, player))
	}
	// Saved once the clock runs, so a slow save never lengthens the countdown.
	a.persist(snap{Next: 1, Totals: p.totals, Times: p.times, Answers: p.answers})
	if !a.waitFor(p, end) {
		return
	}
	s.over = true
	// Answers already queued arrived in time or not by their own stamp.
	for drained := false; !drained; {
		select {
		case e := <-a.events:
			a.handle(p, e, nil)
		default:
			drained = true
		}
	}
	a.finish(p)
}

// The 3 s before the first question, for either mode; false when the match ended in it.
func (a *actor) countdownFirst(p *play) bool {
	p.countdown = a.clock.Now().Add(countdownTime)
	a.broadcast(p, map[string]any{"type": "countdown", "seconds": seconds(countdownTime)})
	ok := a.waitFor(p, a.clock.After(countdownTime))
	p.countdown = time.Time{}
	return ok
}

// False when the match ended while waiting (an abandon decided it, or the server
// stops). A sprint every player has finished stops waiting (Q-P3-24).
func (a *actor) waitFor(p *play, until <-chan time.Time) bool {
	for {
		select {
		case e := <-a.events:
			a.handle(p, e, nil)
		case <-until:
			return true
		case <-a.quit:
			p.closeAll("server shutting down")
			return false
		}
		if p.decided() {
			a.finish(p)
			return false
		}
		if s := p.sprint; s != nil && s.live && a.allDone(p) {
			return true
		}
	}
}

func (a *actor) allDone(p *play) bool {
	for _, player := range a.def.Players {
		if p.sprint.at[player] < len(a.def.Rounds) {
			return false
		}
	}
	return true
}

func (a *actor) sprintAnswer(p *play, e event) {
	s := p.sprint
	// Sent before the start (during the countdown) never counts, however it queued.
	if _, isPlayer := p.totals[e.player]; !isPlayer || !s.live || e.at.Before(s.start) {
		return
	}
	i := s.at[e.player]
	if e.n != i+1 || i >= len(a.def.Rounds) {
		return
	}
	r := a.def.Rounds[i]
	if e.choice < 0 || e.choice >= len(r.Options) {
		return
	}
	took := compensated(e.at.Sub(s.start), p.rtts[e.player])
	if took > sprintTime {
		return
	}
	right := e.choice == r.Correct
	choice, ms := e.choice, took.Milliseconds()
	p.answers[e.player] = append(p.answers[e.player], answerRec{
		Round: e.n, QuestionID: r.Question, Choice: &choice, Correct: &right, Ms: &ms,
	})
	s.at[e.player]++
	if right {
		p.totals[e.player]++
		p.times[e.player] = took // when the total was reached: the tie-break
	}
	if s.over {
		return
	}
	if seat, here := p.seats[e.player]; here {
		a.tell(p, e.player, seat, map[string]any{"type": "judged", "n": e.n, "correct": right})
	}
	a.broadcast(p, map[string]any{"type": "score", "correct": p.totals})
	if seat, here := p.seats[e.player]; here {
		a.tell(p, e.player, seat, a.nextFor(p, e.player))
	}
}

// A player back within the grace (after the countdown): where they stand.
func (a *actor) sprintResume(p *play, player string, seat seat) {
	s := p.sprint
	left := max(0, s.until.Sub(a.clock.Now()))
	seat.send(map[string]any{"type": "resume", "seconds": seconds(left), "correct": p.totals})
	if !s.over { // the final is on its way: nothing more to answer
		seat.send(a.nextFor(p, player))
	}
}

// The player's next question, without its key, or done when none is left.
func (a *actor) nextFor(p *play, player string) map[string]any {
	i := p.sprint.at[player]
	if i >= len(a.def.Rounds) {
		return map[string]any{"type": "done"}
	}
	r := a.def.Rounds[i]
	return map[string]any{"type": "question", "n": i + 1, "stem": r.Stem, "options": r.Options}
}

// The final message's review: every question either player reached, keys included,
// and each player's answers.
func (a *actor) review(p *play) map[string]any {
	// Question 1 reached everyone once the sprint began, answered or not.
	reached := 0
	if p.sprint.live {
		reached = 1
	}
	for _, n := range p.sprint.at {
		reached = max(reached, n+1)
	}
	reached = min(reached, len(a.def.Rounds))
	questions := make([]map[string]any, 0, reached)
	for i, r := range a.def.Rounds[:reached] {
		questions = append(questions, map[string]any{"n": i + 1, "stem": r.Stem, "options": r.Options, "correct": r.Correct})
	}
	answers := map[string][]answerRec{}
	for _, player := range a.def.Players {
		answers[player] = append([]answerRec{}, p.answers[player]...)
	}
	return map[string]any{"questions": questions, "answers": answers}
}

// One player's message; a seat too slow to take it is dropped as if it had left.
func (a *actor) tell(p *play, player string, s seat, msg any) {
	if !s.send(msg) {
		s.close("too slow")
		a.handle(p, event{kind: "leave", player: player, seat: s}, nil)
	}
}

// Whole seconds, rounded up: a client's countdown never runs past the server's.
func seconds(d time.Duration) int {
	return int((d + time.Second - 1) / time.Second)
}
