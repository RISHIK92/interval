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
	Kind  string `json:"kind"`  // speed, focus
	Round int    `json:"round"` // the round, or a sprint's question
	Ms    *int64 `json:"ms"`    // a speed signal's compensated time; null for focus
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
