package main

import "time"

// MATCH-5: what the network added to an answer's time, at most this much, is taken off.
const maxCompensation = 150 * time.Millisecond

// The answer's time on the server's clock, less half the player's measured round-trip.
func compensated(elapsed, rtt time.Duration) time.Duration {
	return max(0, elapsed-min(rtt/2, maxCompensation))
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
