package main

import (
	"sort"
	"sync"
)

type Leaderboard struct {
	totals map[string]int64
	mu     sync.Mutex
}

func NewLeaderboard() *Leaderboard {
	return &Leaderboard{totals: map[string]int64{}}
}

func (l *Leaderboard) ordered() []string {
	players := make([]string, 0, len(l.totals))
	for p := range l.totals {
		players = append(players, p)
	}
	sort.Slice(players, func(i, j int) bool {
		a, b := players[i], players[j]
		if l.totals[a] != l.totals[b] {
			return l.totals[a] > l.totals[b]
		}
		return a < b
	})
	return players
}

func (l *Leaderboard) add(player string, points int64) int64 {
	if points <= 0 {
		panic("points must be positive")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.totals[player] += points
	return l.totals[player]
}

func (l *Leaderboard) top(k int64) []string {
	if k < 0 {
		panic("negative k")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	players := l.ordered()
	if int64(len(players)) > k {
		players = players[:k]
	}
	return players
}

func (l *Leaderboard) rank(player string) *int64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.totals[player]; !ok {
		return nil
	}
	for i, p := range l.ordered() {
		if p == player {
			r := int64(i + 1)
			return &r
		}
	}
	return nil
}

func (l *Leaderboard) remove(player string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.totals[player]; !ok {
		return false
	}
	delete(l.totals, player)
	return true
}
