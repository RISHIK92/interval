package main

import (
	"testing"
	"time"
)

// P3-W15-S03 (MATCH-5, Q-P3-22): the server's clock, less half the round-trip, at most
// 150 ms; 100 for a right answer and up to 50 more for speed.

func TestCompensation(t *testing.T) {
	ms := time.Millisecond
	for _, tc := range []struct {
		elapsed, rtt, want time.Duration
	}{
		{4000 * ms, 0, 4000 * ms},
		{4000 * ms, 100 * ms, 3950 * ms},
		{4000 * ms, 300 * ms, 3850 * ms}, // half is 150: the cap
		{4000 * ms, 1000 * ms, 3850 * ms},
		{100 * ms, 300 * ms, 0}, // never below zero
	} {
		if got := compensated(tc.elapsed, tc.rtt); got != tc.want {
			t.Errorf("compensated(%v, %v) = %v, want %v", tc.elapsed, tc.rtt, got, tc.want)
		}
	}
}

func TestWinner(t *testing.T) {
	s := time.Second
	for _, tc := range []struct {
		name   string
		totals map[string]int
		times  map[string]time.Duration
		want   string
	}{
		{"more taken", map[string]int{"a": 4, "b": 3}, map[string]time.Duration{"a": 50 * s, "b": 10 * s}, "a"},
		{"a tie goes to the faster", map[string]int{"a": 400, "b": 400}, map[string]time.Duration{"a": 30 * s, "b": 20 * s}, "b"},
		{"tied both ways is a draw", map[string]int{"a": 400, "b": 400}, map[string]time.Duration{"a": 20 * s, "b": 20 * s}, ""},
	} {
		if got := winner(tc.totals, tc.times); got != tc.want {
			t.Errorf("%s: winner = %q, want %q", tc.name, got, tc.want)
		}
	}
}
