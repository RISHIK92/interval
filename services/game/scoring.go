package main

import (
	"math"
	"time"
)

// MATCH-5: what the network added to an answer's time, at most this much, is taken off.
const maxCompensation = 150 * time.Millisecond

// The answer's time on the server's clock, less half the player's measured round-trip.
func compensated(elapsed, rtt time.Duration) time.Duration {
	return max(0, elapsed-min(rtt/2, maxCompensation))
}

// Q-P3-22 (owner, 2026-11-02): 100 for a right answer, and up to 50 more the faster it
// came; nothing for a wrong one.
func points(correct bool, elapsed, limit time.Duration) int {
	if !correct {
		return 0
	}
	speed := 1 - float64(elapsed)/float64(limit)
	return 100 + int(math.Round(50*min(1, max(0, speed))))
}

// The highest total wins; a tie goes to the lower total answer time; "" is a draw.
func winner(totals map[string]int, times map[string]time.Duration) string {
	best, tied := "", false
	for player := range totals {
		switch {
		case best == "":
			best = player
		case totals[player] > totals[best] ||
			(totals[player] == totals[best] && times[player] < times[best]):
			best, tied = player, false
		case totals[player] == totals[best] && times[player] == times[best]:
			tied = true
		}
	}
	if tied {
		return ""
	}
	return best
}
