package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"slices"
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
	closing  bool                 // the end is decided: no more code, the judgings in flight finish
	away     map[string]bool      // past the grace and not back (Q-P5-16)
	lost     map[string]time.Time // P5-W31-S04a: when the page lost focus, until it's back
	joined   map[string]bool      // seated at least once in this battle (or before its restart)
	lastRun  map[string]time.Time
	lastSub  map[string]time.Time
	judging  map[string]bool // "player run" or "player submit": one judging of each at a time
	best     map[string]bestSubmission
	bestCode map[string]*codeMsg // P5-W33: each best's code, for code similarity
	hints    map[string][]int    // Q-WD-17: the levels each player has opened, in order
	pending  int                 // judgings in flight
	seq      int                 // ADR-0048: practice progress messages sent
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
	failed   bool     // the judge failed: nothing is known about the code
	code     *codeMsg // what was judged: kept when it's the player's best (P5-W33)
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
		start: a.clock.Now(), away: map[string]bool{}, joined: map[string]bool{}, lost: map[string]time.Time{},
		lastRun: map[string]time.Time{}, lastSub: map[string]time.Time{},
		judging: map[string]bool{}, best: map[string]bestSubmission{}, bestCode: map[string]*codeMsg{},
		hints: map[string][]int{},
	}
	practice := a.def.Battle.Practice
	if a.from != nil && !a.from.Started.IsZero() {
		// A restart: the same battle, on the same clock, with the bests it had. Whoever
		// had submitted had joined; the rest may still come back (Q-P5-16).
		b.start = a.from.Started
		b.seq, b.revealed = a.from.Seq, a.from.Revealed
		for player, levels := range a.from.Hints {
			// Only real levels, each once: a damaged snapshot charges nothing it can't
			// name, and never indexes past the costs.
			for _, level := range levels {
				if level >= 1 && level <= len(hintCosts) && !slices.Contains(b.hints[player], level) {
					b.hints[player] = append(b.hints[player], level)
				}
			}
		}
		for player, points := range a.from.Totals {
			if at, ok := a.from.Times[player]; ok {
				b.best[player] = bestSubmission{Points: points, At: at, Made: true, Passed: a.from.Passed[player]}
				b.joined[player] = true
			}
		}
	}
	p.battle = b
	for player := range p.seats {
		b.joined[player] = true
	}
	elapsed := a.clock.Now().Sub(b.start)
	length := a.def.Battle.length()
	end := a.clock.After(max(0, length-elapsed))
	// ADR-0048: in practice, the player reveals the extension (practiceReveal).
	var revealAt <-chan time.Time
	if !practice {
		revealAt = a.clock.After(max(0, battleReveal-elapsed))
		if elapsed >= battleReveal {
			b.revealed = true
			revealAt = nil
		}
	}
	// Each seat its own: a player's hints are theirs alone.
	for player, s := range p.seats {
		a.tell(p, player, s, a.battleState(p, player))
	}
	a.persistBattle(p)
	for !b.closing {
		select {
		case e := <-a.events:
			a.handle(p, e, nil)
		case <-revealAt:
			b.revealed = true
			revealAt = nil
			a.broadcast(p, a.extensionMessage(battleLength-battleReveal))
			// Every total now counts the extension's tests (Q-WD-14).
			a.broadcastBests(p)
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
	// An away still open at the end counts to the end (Q-P5-17).
	over := a.clock.Now()
	if last := b.start.Add(length); over.After(last) {
		over = last
	}
	for player := range b.lost {
		a.cameBack(p, player, over)
	}
	a.finishBattle(p)
}

// Q-P5-16: early, once every player still in it is perfect after the reveal, or nobody is
// left (every player away).
func (a *actor) battleDone(p *play) bool {
	b := p.battle
	// ADR-0048: a practice session goes on however well it's going.
	allAway, allPerfect := true, b.revealed && !a.def.Battle.Practice
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

// Where the battle stands, for a player at the start or coming back.
func (a *actor) battleState(p *play, player string) map[string]any {
	b := p.battle
	left := max(0, a.def.Battle.length()-a.clock.Now().Sub(b.start))
	state := map[string]any{
		"type": "battle", "problem": a.def.Battle.Problem, "seconds": seconds(left),
		"revealed": b.revealed, "best": a.bests(p, player), "progress": a.testsPassed(p),
	}
	if a.def.Battle.Practice {
		// ADR-0048: the page shows no clock; seconds is the session's cap.
		state["practice"] = true
	}
	if a.def.Battle.Hints != nil {
		// Q-WD-17: what each level costs, and the texts of those this player opened.
		opened := []map[string]any{}
		for _, level := range b.hints[player] {
			opened = append(opened, map[string]any{"level": level, "text": a.def.Battle.Hints[level-1]})
		}
		state["hints"] = map[string]any{
			"costs": a.def.Battle.hintCosts(), "opened": opened,
			"spent": a.def.Battle.hintCost(b.hints[player]),
		}
	}
	if b.revealed {
		// A player back after the reveal is shown it again.
		state["extension"] = a.extensionMessage(left)
	}
	return state
}

// The reveal (Q-P5-15): extension.md and the extended starters, never sent before it.
func (a *actor) extensionMessage(left time.Duration) map[string]any {
	msg := map[string]any{"type": "extension", "seconds": seconds(left)}
	if e := a.def.Battle.Extension; e != nil {
		msg["statement"], msg["starters"] = e.Statement, e.Starters
	}
	return msg
}

// Each player's best, to each seat as that player sees it: points (bests), and
// (Q-WD-14) tests passed, counts only, never which tests (LLDQ-4), with (Q-WD-17) the
// hint levels each has opened, never their text.
func (a *actor) broadcastBests(p *play) {
	for player, s := range p.seats {
		a.tell(p, player, s, map[string]any{"type": "best", "best": a.bests(p, player), "progress": a.testsPassed(p)})
	}
}

type testsPassed struct {
	Passed int   `json:"passed"`
	Total  int   `json:"total"`
	Hints  []int `json:"hints"`
}

func (a *actor) testsPassed(p *play) map[string]testsPassed {
	total := a.def.Battle.tests(p.battle.revealed)
	out := map[string]testsPassed{}
	for _, player := range a.def.Players {
		// Q-WD-17 (owner, 2026-11-24): a hint taken is public, as its levels.
		levels := p.battle.hints[player]
		if levels == nil {
			levels = []int{}
		}
		out[player] = testsPassed{Passed: p.battle.best[player].Passed, Total: total, Hints: levels}
	}
	return out
}

// Each player's points as `viewer` is shown them: their own net of the hints they
// opened (Q-WD-17), never below 0; another's as scored, since points stay private to
// their player until the results (owner, 2026-11-24).
func (a *actor) bests(p *play, viewer string) map[string]int {
	out := map[string]int{}
	for _, player := range a.def.Players {
		out[player] = p.battle.best[player].Points
		if player == viewer {
			out[player] = a.points(p, player)
		}
	}
	return out
}

func (a *actor) points(p *play, player string) int {
	b := p.battle
	return max(0, b.best[player].Points-a.def.Battle.hintCost(b.hints[player]))
}

// Q-WD-17: a player opens a hint level: charged once per match (a level already open
// is sent again, free), saved (retried) before its text goes so a restart neither
// refunds nor charges it again. Every seat then hears which levels each player has
// opened; only this one gets the text. Nothing is sent for a level that isn't one, a
// battle without hints, or one that's over.
func (a *actor) battleHint(p *play, e event) {
	b := p.battle
	hints := a.def.Battle.Hints
	seat := p.seats[e.player]
	if _, isPlayer := p.totals[e.player]; !isPlayer || hints == nil || e.n < 1 || e.n > len(hints) || b.closing || seat == nil {
		return
	}
	if !slices.Contains(b.hints[e.player], e.n) {
		b.hints[e.player] = append(b.hints[e.player], e.n)
		a.saveBattle(p, true)
		a.broadcastBests(p)
	}
	a.tell(p, e.player, seat, map[string]any{
		"type": "hint", "level": e.n, "text": hints[e.n-1],
		"spent": a.def.Battle.hintCost(b.hints[e.player]),
	})
}

func (a *actor) persistBattle(p *play) { a.saveBattle(p, false) }

// retry: this save records a hint level, which a restart must not refund.
func (a *actor) saveBattle(p *play, retry bool) {
	b := p.battle
	totals, times, passed := map[string]int{}, map[string]time.Duration{}, map[string]int{}
	for player, s := range b.best {
		totals[player], times[player], passed[player] = s.Points, s.At, s.Passed
	}
	a.persist(snap{Started: b.start, Totals: totals, Times: times, Passed: passed, Hints: b.hints, Signals: p.signals, Seq: b.seq, Revealed: b.revealed && a.def.Battle.Practice, Retry: retry})
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
	if b.closing || at >= a.def.Battle.length() {
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
	if a.def.Battle.Practice && a.limits != nil {
		// ADR-0048: the daily caps, after every check that spends nothing.
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		code, err := a.limits.takePractice(ctx, e.player, a.def.Battle.Problem, msg.submit, e.at)
		cancel()
		if err != nil {
			// Not counted, so not judged: the caps would mean nothing otherwise.
			a.log.Error("game: practice limits unavailable", "player", e.player, "error", err.Error())
			refuse("unavailable", "try again in a moment")
			return
		}
		if code != "" {
			refuse(code, practiceRefusals[code])
			return
		}
	}
	last[e.player] = e.at
	// By when it was sent: the reveal's timer may not have been handled yet. A practice
	// session has no timer: its player reveals.
	revealed := b.revealed || (!a.def.Battle.Practice && at >= battleReveal)
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
		out := judgedMsg{submit: msg.submit, sent: sent, at: at, revealed: revealed, failed: true, code: msg}
		safely(a.log, "judging", func() {
			judged := judgedMsg{submit: msg.submit, sent: sent, at: at, revealed: revealed, passed: make([]bool, scenarios), code: msg}
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
	passed := 0
	for _, ok := range j.passed {
		if ok {
			passed++
		}
	}
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
	before := b.best[e.player]
	b.best[e.player] = before.improvedBy(points, passed, j.at)
	if b.best[e.player] != before {
		b.bestCode[e.player] = j.code
	}
	tell(map[string]any{"type": "submitted", "points": points, "layers": layers, "best": a.points(p, e.player)})
	a.broadcastBests(p)
	if a.def.Battle.Practice {
		b.seq++
	}
	// Saved before the progress goes, so a restart doesn't send a sequence number again;
	// the save is tried three times, and only when all fail can a restart reuse it (the
	// worker then drops that Submit as a repeat, LOAD-5).
	a.persistBattle(p)
	if a.def.Battle.Practice && a.progress != nil {
		a.progress(practiceJudged{
			MatchID: a.id, Seq: b.seq, User: e.player, Problem: a.def.Battle.Problem,
			Points: points, Layers: layers, Language: j.code.language,
			At: j.sent.UTC().Format(time.RFC3339),
		})
	}
}

// The result: the best points win, an equal best going to whoever reached it first. A
// player who never submitted has no time and loses any tie; one who never submitted and
// never joined, or left and never came back, abandoned (Q-P5-16).
func (a *actor) finishBattle(p *play) {
	b := p.battle
	for _, player := range a.def.Players {
		s := b.best[player]
		p.totals[player] = a.points(p, player)
		p.times[player] = s.At
		if !s.Made {
			p.times[player] = a.def.Battle.length()
			// ADR-0048: a practice session is never abandoned: it just ends.
			if !a.def.Battle.Practice && (b.away[player] || !b.joined[player]) {
				p.abandoned = append(p.abandoned, player)
			}
		}
	}
	// §6.9 (Q-P5-20): in human mode, similar best submissions are a signal on
	// both, for review. shortcut: bests from before a restart aren't kept, so aren't
	// compared; persist them if restarts mid-battle become common.
	if a.def.Battle.Mode != "ai" && !a.def.Battle.Practice {
		minute := b.minute(a.clock.Now())
		// Both starters a player may have begun from: the base one and, after the reveal,
		// the extended one.
		starters := []map[string]string{a.def.Battle.Starters}
		if e := a.def.Battle.Extension; e != nil {
			starters = append(starters, e.Starters)
		}
		for _, pair := range similarPairs(b.bestCode, starters...) {
			for _, player := range pair {
				a.battleRaise(p, player, fairPlaySignal{Kind: "similar", Round: minute})
			}
		}
	}
	p.places = places(a.def.Players, p.totals, p.times, p.abandoned)
	a.finish(p)
}

// Q-P5-18: a battle's placings, by points, then time, the abandoned last together;
// equal points and time share a place (1, 2, 2, 4), as the worker ranks a room.
func places(players []string, totals map[string]int, times map[string]time.Duration, abandoned []string) map[string]int {
	order := slices.Clone(players)
	gone := func(p string) bool { return slices.Contains(abandoned, p) }
	before := func(x, y string) bool {
		if gone(x) || gone(y) {
			return !gone(x) && gone(y) // the abandoned are last, together
		}
		if totals[x] != totals[y] {
			return totals[x] > totals[y]
		}
		return times[x] < times[y]
	}
	slices.SortStableFunc(order, func(x, y string) int {
		switch {
		case before(x, y):
			return -1
		case before(y, x):
			return 1
		}
		return 0
	})
	out := map[string]int{}
	for i, p := range order {
		out[p] = i + 1
		if i > 0 && !before(order[i-1], p) {
			out[p] = out[order[i-1]]
		}
	}
	return out
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

// ADR-0048 (Q-WD-28): what the worker keeps a practice player's best from, after each
// judged Submit (LPUSH game:practice). Per-layer counts only (LLDQ-4), never code; seq
// counts the session's messages from 1, so the worker takes each once (LOAD-5). The
// shape is pinned in testdata/practice_judged.json for the worker's tests.
type practiceJudged struct {
	MatchID  string                    `json:"match_id"`
	Seq      int                       `json:"seq"`
	User     string                    `json:"user"`
	Problem  string                    `json:"problem"`
	Points   int                       `json:"points"`
	Layers   map[string]map[string]int `json:"layers"`
	Language string                    `json:"language"`
	At       string                    `json:"at"`
}

// The words for each daily cap's refusal.
var practiceRefusals = map[string]string{
	"daily_runs":            "that's today's runs: try again tomorrow",
	"daily_submits":         "that's today's submissions: try again tomorrow",
	"daily_problem_submits": "that's today's submissions for this problem: try another",
}

// ADR-0048: the extension, when the practice player asks for it; once, and never in a
// battle, whose clock reveals it.
func (a *actor) practiceReveal(p *play) {
	b := p.battle
	if !a.def.Battle.Practice || a.def.Battle.Extension == nil || b.revealed || b.closing {
		return
	}
	b.revealed = true
	a.persistBattle(p)
	a.broadcast(p, a.extensionMessage(max(0, practiceLength-a.clock.Now().Sub(b.start))))
	a.broadcastBests(p)
}
