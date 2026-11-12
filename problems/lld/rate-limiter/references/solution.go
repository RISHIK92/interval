package main

import "sync"

type RateLimiter struct {
	limit  int64
	window int64
	// Each client's allowed requests, oldest first, and the time of its last call.
	log  map[string][]int64
	last map[string]int64
	mu   sync.Mutex
}

func NewRateLimiter(limit int64, windowMs int64) *RateLimiter {
	if limit < 1 || windowMs < 1 {
		panic("limit and window must be at least 1")
	}
	return &RateLimiter{limit: limit, window: windowMs, log: map[string][]int64{}, last: map[string]int64{}}
}

func (r *RateLimiter) current(client string, now int64) []int64 {
	if previous, ok := r.last[client]; ok && now < previous {
		panic("time went backwards")
	}
	r.last[client] = now
	entries := r.log[client]
	for len(entries) > 0 && entries[0] <= now-r.window {
		entries = entries[1:]
	}
	r.log[client] = entries
	return entries
}

func (r *RateLimiter) allow(client string, nowMs int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	entries := r.current(client, nowMs)
	if int64(len(entries)) >= r.limit {
		return false
	}
	r.log[client] = append(entries, nowMs)
	return true
}

func (r *RateLimiter) remaining(client string, nowMs int64) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.limit - int64(len(r.current(client, nowMs)))
}
