package main

import (
	"slices"
	"time"
)

// P3-W18-S02 (§6.9, ADR-0006 C-14, Q-P3-20): fair-play signals. An answer sooner than
// this after its question arrived (compensated), or a focus change while a question is
// live, is a signal; the worker flags a player with three in a match for review. The
// game server only records them: nothing here penalises anyone.
const tooFast = 400 * time.Millisecond

type fairPlaySignal struct {
	Kind  string `json:"kind"`            // speed, focus; a battle's paste, away (P5-W31-S04a)
	Round int    `json:"round"`           // the round, a sprint's question, or a battle's minute
	Ms    *int64 `json:"ms"`              // speed: its compensated time; away: how long; else null
	Chars *int   `json:"chars,omitempty"` // paste: how many characters
}

// Never for a ghost's or bot's seat; a focus signal once a round (one switch of tab
// can fire both blur and visibilitychange).
func (a *actor) raise(p *play, player string, s fairPlaySignal) {
	if _, isPlayer := p.totals[player]; !isPlayer {
		return
	}
	if g := a.def.Ghost; g != nil && g.Player == player {
		return
	}
	if s.Kind == "focus" && slices.Contains(p.signals[player], s) {
		return
	}
	p.signals[player] = append(p.signals[player], s)
}

func (a *actor) speed(p *play, player string, round int, took time.Duration) {
	if took < tooFast {
		ms := took.Milliseconds()
		a.raise(p, player, fairPlaySignal{Kind: "speed", Round: round, Ms: &ms})
	}
}

// P5-W31-S04a (§6.9, Q-P5-17): a battle's signals, for review. A paste this long that
// wasn't already in the player's editor (the page checks that), or a focus loss this
// long, is one. At most battleSignalCap of each kind: plenty to flag, bounded for the
// result.
const (
	pasteAt         = 200
	awayAt          = 30 * time.Second
	battleSignalCap = 20
)

// The battle's minute, 1 to 45, at a time.
func (b *battleRun) minute(at time.Time) int {
	return min(max(int(at.Sub(b.start)/time.Minute)+1, 1), int(battleLength/time.Minute))
}

// focus, back or paste (e.n its characters) from a battle's player.
func (a *actor) battleSignal(p *play, e event) {
	b := p.battle
	// Read after the end while judgings finish: a paste then is past time, and an away
	// counts only to the end.
	end := b.start.Add(battleLength)
	if e.at.After(end) {
		if e.kind != "back" {
			return
		}
		e.at = end
	}
	switch e.kind {
	case "focus":
		if _, lost := b.lost[e.player]; !lost {
			b.lost[e.player] = e.at // a second blur while away doesn't restart it
		}
	case "back":
		a.cameBack(p, e.player, e.at)
	case "paste":
		if e.n >= pasteAt {
			chars := e.n
			a.battleRaise(p, e.player, fairPlaySignal{Kind: "paste", Round: b.minute(e.at), Chars: &chars})
		}
	}
}

func (a *actor) cameBack(p *play, player string, at time.Time) {
	b := p.battle
	since, lost := b.lost[player]
	if !lost {
		return
	}
	delete(b.lost, player)
	if away := at.Sub(since); away >= awayAt {
		ms := away.Milliseconds()
		a.battleRaise(p, player, fairPlaySignal{Kind: "away", Round: b.minute(since), Ms: &ms})
	}
}

func (a *actor) battleRaise(p *play, player string, s fairPlaySignal) {
	n := 0
	for _, raised := range p.signals[player] {
		if raised.Kind == s.Kind {
			n++
		}
	}
	if n < battleSignalCap {
		a.raise(p, player, s)
		a.persistBattle(p) // a restart keeps it: one paste flags (Q-P5-17)
	}
}
