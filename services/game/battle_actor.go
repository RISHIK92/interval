package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"time"
)

// P5-W31-S02b-2 (§6.5, LOAD-2; Q-P5-15, Q-P5-16): an LLD battle, played by the match's
// actor. Players write code in their own time and send it to Run (the visible tests,
// never scored) or Submit (every live layer, scored); Velox judges it (ADR-0041) off
// the actor's goroutine, which only hears back. The extension is revealed to all at
// 30:00 and the battle ends at 45:00, or sooner once everyone still in it is perfect
// after the reveal, or everyone is away. A player who drops is away, not abandoned:
// their best submission stands, and they may come back until the end.
//
// Code counts by when it was sent, as a sprint's answers do: what was sent before the
// end is judged and scored even when its judging finishes after it, and what was sent
// after the reveal is judged with the extension.

const (
	runCooldown    = 5 * time.Second
	submitCooldown = 30 * time.Second
	// A submission's code: far past any solution, well inside a judge file (1 MB).
	maxCodeBytes = 256 << 10
	// A judging past this is the judge's fault, not the code's: the player may retry.
	judgeWait = 5 * time.Minute
	// At the end, how long the judgings already sent are waited for.
	endWait = 2 * time.Minute
)

type battleRun struct {
	start    time.Time
	revealed bool
	closing  bool            // the end is decided: no more code, the judgings in flight finish
	away     map[string]bool // past the grace and not back (Q-P5-16)
	joined   map[string]bool // seated at least once in this battle (or before its restart)
	lastRun  map[string]time.Time
	lastSub  map[string]time.Time
	judging  map[string]bool // "player run" or "player submit": one judging of each at a time
	best     map[string]bestSubmission
	pending  int // judgings in flight
}

// Code from a player: a Run or a Submit.
type codeMsg struct {
	submit   bool
	language string
	code     string
}

// What the judge said about one submission, back on the actor's goroutine.
type judgedMsg struct {
	submit   bool
	sent     time.Time     // when the code arrived: its cooldown's start
	at       time.Duration // the same, since the battle began
	revealed bool          // judged with the extension (sent after the reveal)
	passed   []bool        // per scenario of the battle; Run: only visible ones count
	tests    []map[string]any
	failed   bool // the judge failed: nothing is known about the code
}

// A random (version 4) UUID for each judge job: crypto/rand never fails on the
// platforms Go supports (Go 1.24), and nothing else here needs a UUID library.
func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func judgingKey(player string, submit bool) string {
	if submit {
		return player + " submit"
	}
	return player + " run"
}

func (a *actor) battle(p *play) {
	b := &battleRun{
		start: a.clock.Now(), away: map[string]bool{}, joined: map[string]bool{},
		lastRun: map[string]time.Time{}, lastSub: map[string]time.Time{},
		judging: map[string]bool{}, best: map[string]bestSubmission{},
	}
	if a.from != nil && !a.from.Started.IsZero() {
		// A restart: the same battle, on the same clock, with the bests it had. Whoever
		// had submitted had joined; the rest may still come back (Q-P5-16).
		b.start = a.from.Started
		for player, points := range a.from.Totals {
			if at, ok := a.from.Times[player]; ok {
				b.best[player] = bestSubmission{Points: points, At: at, Made: true}
				b.joined[player] = true
			}
		}
	}
	p.battle = b
	for player := range p.seats {
		b.joined[player] = true
	}
	elapsed := a.clock.Now().Sub(b.start)
	revealAt := a.clock.After(max(0, battleReveal-elapsed))
	end := a.clock.After(max(0, battleLength-elapsed))
	if elapsed >= battleReveal {
		b.revealed = true
		revealAt = nil
	}
	a.broadcast(p, a.battleState(p))
	a.persistBattle(p)
	for !b.closing {
		select {
		case e := <-a.events:
			a.handle(p, e, nil)
		case <-revealAt:
			b.revealed = true
			revealAt = nil
			a.broadcast(p, map[string]any{"type": "extension", "seconds": seconds(battleLength - battleReveal)})
		case <-end:
			b.closing = true
		case <-a.quit:
			p.closeAll("server shutting down")
			return
		}
		if a.battleDone(p) {
			b.closing = true
		}
	}
	// The end is decided: code already sent is still judged and scored.
	wait := a.clock.After(endWait)
	for b.pending > 0 {
		select {
		case e := <-a.events:
			a.handle(p, e, nil)
		case <-wait:
			a.log.Error("game: battle ended with judgings unfinished", "pending", b.pending)
			b.pending = 0
		case <-a.quit:
			p.closeAll("server shutting down")
			return
		}
	}
	a.finishBattle(p)
}

// Q-P5-16: early, once every player still in it is perfect after the reveal, or nobody is
// left (every player away).
func (a *actor) battleDone(p *play) bool {
	b := p.battle
	allAway, allPerfect := true, b.revealed
	for _, player := range a.def.Players {
		if b.away[player] {
			continue
		}
		allAway = false
		if b.best[player].Points < maxBattlePoints {
			allPerfect = false
		}
	}
	return allAway || allPerfect
}

// Where the battle stands, for everyone at the start and for a player coming back.
func (a *actor) battleState(p *play) map[string]any {
	b := p.battle
	left := max(0, battleLength-a.clock.Now().Sub(b.start))
	return map[string]any{
		"type": "battle", "problem": a.def.Battle.Problem, "seconds": seconds(left),
		"revealed": b.revealed, "best": a.bests(p),
	}
}

func (a *actor) bests(p *play) map[string]int {
	out := map[string]int{}
	for _, player := range a.def.Players {
		out[player] = p.battle.best[player].Points
	}
	return out
}

func (a *actor) persistBattle(p *play) {
	b := p.battle
	totals, times := map[string]int{}, map[string]time.Duration{}
	for player, s := range b.best {
		totals[player], times[player] = s.Points, s.At
	}
	a.persist(snap{Started: b.start, Totals: totals, Times: times})
}

// A Run or a Submit, checked here and judged off this goroutine.
func (a *actor) battleCode(p *play, e event) {
	b := p.battle
	msg := e.code
	if _, isPlayer := p.totals[e.player]; !isPlayer {
		return
	}
	at := e.at.Sub(b.start)
	seat := p.seats[e.player]
	// Refusals carry a stable code for the page and words for the player.
	refuse := func(code, reason string) {
		if seat != nil {
			a.tell(p, e.player, seat, map[string]any{"type": "refused", "code": code, "reason": reason, "submit": msg.submit})
		}
	}
	if b.closing || at >= battleLength {
		refuse("over", "the battle is over")
		return
	}
	if _, ok := a.def.Battle.Languages[msg.language]; !ok || len(msg.code) > maxCodeBytes {
		refuse("invalid", "not a language of this battle, or too much code")
		return
	}
	key := judgingKey(e.player, msg.submit)
	if b.judging[key] {
		refuse("judging", "still judging the last one")
		return
	}
	last, wait := b.lastRun, runCooldown
	if msg.submit {
		last, wait = b.lastSub, submitCooldown
	}
	if prev, ok := last[e.player]; ok && e.at.Sub(prev) < wait {
		refuse("cooldown", fmt.Sprintf("wait %d s", seconds(wait-e.at.Sub(prev))))
		return
	}
	last[e.player] = e.at
	// By when it was sent: the reveal's timer may not have been handled yet.
	revealed := b.revealed || at >= battleReveal
	include := func(s battleScenario) bool {
		if !msg.submit {
			return s.Layer == "visible"
		}
		return s.Layer != "extension" || revealed
	}
	priority := "run"
	if msg.submit {
		priority = "casual"
	}
	jobs := a.def.Battle.jobs(msg.language, msg.code, include, priority, e.at, newUUID)
	b.judging[key] = true
	b.pending++
	player, scenarios, sent := e.player, len(a.def.Battle.Scenarios), e.at
	// Ends with the actor: nothing judges for a battle that's over.
	ctx, cancel := context.WithTimeout(context.Background(), judgeWait)
	go func() {
		select {
		case <-a.ended:
			cancel()
		case <-ctx.Done():
		}
	}()
	go func() {
		defer cancel()
		out := judgedMsg{submit: msg.submit, sent: sent, at: at, revealed: revealed, failed: true}
		safely(a.log, "judging", func() {
			judged := judgedMsg{submit: msg.submit, sent: sent, at: at, revealed: revealed, passed: make([]bool, scenarios)}
			for _, j := range jobs {
				result, err := a.judge.Judge(ctx, j.job)
				if err == nil && (result.Status == nil || *result.Status != "done" || len(result.Runs) != len(j.scenarios)) {
					err = fmt.Errorf("an unusable result for job %s", *j.job.Id)
				}
				if err != nil {
					// LOAD-5: said and counted; the player is told and may try again.
					a.log.Error("game: judging failed", "player", player, "submit", msg.submit, "error", err.Error())
					return
				}
				for k, run := range result.Runs {
					i := j.scenarios[k]
					ok := run.Verdict != nil && *run.Verdict == "ok" &&
						run.Report != nil && run.Report.Passed != nil && *run.Report.Passed
					judged.passed[i] = ok
					if !msg.submit {
						test := map[string]any{"passed": ok}
						if run.Verdict != nil {
							test["verdict"] = *run.Verdict
						}
						if m := run.Report; m != nil && m.FirstMismatch != nil && m.FirstMismatch.Call != nil && m.FirstMismatch.Reason != nil {
							test["call"] = *m.FirstMismatch.Call
							test["reason"] = *m.FirstMismatch.Reason
						}
						judged.tests = append(judged.tests, test)
					}
				}
			}
			out = judged
		})
		if !a.post(event{kind: "judged", player: player, judged: &out}) {
			// The battle ended (past endWait) or its actor is stuck: the score is lost.
			a.log.Error("game: a judging's result was dropped", "player", player, "submit", msg.submit)
		}
	}()
}

// A judge's answer. Run: each visible test (Q-P5-16). Submit: points and passed/total
// per layer, never which hidden test (LLDQ-4).
func (a *actor) battleJudged(p *play, e event) {
	b := p.battle
	if b.pending > 0 {
		b.pending--
	}
	j := e.judged
	delete(b.judging, judgingKey(e.player, j.submit))
	seat := p.seats[e.player]
	tell := func(msg map[string]any) {
		if seat != nil {
			a.tell(p, e.player, seat, msg)
		}
	}
	if j.failed {
		// Not the code's fault: this judging's cooldown is given back, unless a later
		// send has started one of its own since.
		last := b.lastRun
		if j.submit {
			last = b.lastSub
		}
		if last[e.player].Equal(j.sent) {
			delete(last, e.player)
		}
		tell(map[string]any{"type": "judge_error", "submit": j.submit})
		return
	}
	if !j.submit {
		tell(map[string]any{"type": "ran", "tests": j.tests})
		return
	}
	points := a.def.Battle.score(j.passed)
	layers := map[string]map[string]int{}
	for i, s := range a.def.Battle.Scenarios {
		if s.Layer == "extension" && !j.revealed {
			continue
		}
		l := layers[s.Layer]
		if l == nil {
			l = map[string]int{"passed": 0, "total": 0}
			layers[s.Layer] = l
		}
		l["total"]++
		if j.passed[i] {
			l["passed"]++
		}
	}
	b.best[e.player] = b.best[e.player].improvedBy(points, j.at)
	tell(map[string]any{"type": "submitted", "points": points, "layers": layers, "best": b.best[e.player].Points})
	a.broadcast(p, map[string]any{"type": "best", "best": a.bests(p)})
	a.persistBattle(p)
}

// The result: the best points win, an equal best going to whoever reached it first. A
// player who never submitted has no time and loses any tie; one who never submitted and
// never joined, or left and never came back, abandoned (Q-P5-16).
func (a *actor) finishBattle(p *play) {
	b := p.battle
	for _, player := range a.def.Players {
		s := b.best[player]
		p.totals[player] = s.Points
		p.times[player] = s.At
		if !s.Made {
			p.times[player] = battleLength
			if b.away[player] || !b.joined[player] {
				p.abandoned = append(p.abandoned, player)
			}
		}
	}
	a.finish(p)
}

// The code message as a client sends it: {"type":"run"|"submit","language":…,"code":…}.
func parseCode(data []byte) *codeMsg {
	var msg struct {
		Type     string `json:"type"`
		Language string `json:"language"`
		Code     string `json:"code"`
	}
	if json.Unmarshal(data, &msg) != nil || (msg.Type != "run" && msg.Type != "submit") {
		return nil
	}
	return &codeMsg{submit: msg.Type == "submit", language: msg.Language, code: msg.Code}
}
