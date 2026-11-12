package main

import "sync"

type RateLimiter struct {
	limit  int64
	window int64
	// Each client's allowed requests, oldest first, and the time of its last call.
	log  map[string][]int64
	last map[string]int64
	// The extension round: per-client limits, over the default.
	limits map[string]int64
	mu     sync.Mutex
}

func NewRateLimiter(limit int64, windowMs int64) *RateLimiter {
	if limit < 1 || windowMs < 1 {
		panic("limit and window must be at least 1")
	}
	return &RateLimiter{limit: limit, window: windowMs, log: map[string][]int64{}, last: map[string]int64{}, limits: map[string]int64{}}
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
	if int64(len(entries)) >= r.limitFor(client) {
		return false
	}
	r.log[client] = append(entries, nowMs)
	return true
}

func (r *RateLimiter) remaining(client string, nowMs int64) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Never below 0: a lowered limit can leave more allowed than it now permits.
	return max(0, r.limitFor(client)-int64(len(r.current(client, nowMs))))
}

// Under mu.
func (r *RateLimiter) limitFor(client string) int64 {
	if l, ok := r.limits[client]; ok {
		return l
	}
	return r.limit
}

func (r *RateLimiter) setLimit(client string, limit int64) {
	if limit < 1 {
		panic("limit must be at least 1")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.limits[client] = limit
}

func (r *RateLimiter) limitOf(client string) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.limitFor(client)
}
