package main

import "errors"

const cpMaxTtlMs = 1_000_000_000

// The upstream didn't answer.
var cpUnavailable = errors.New("upstream unavailable")

func cpGiven(value string) {
	if value == "" {
		panic("empty")
	}
}

// The slow upstream: it counts every call made to it, and while it's down every call
// fails.
type cpConfigService struct {
	values map[string]string
	down   bool
	calls  int64
}

func (s *cpConfigService) fetch(key string) (string, bool, error) {
	s.calls++
	if s.down {
		return "", false, cpUnavailable
	}
	value, ok := s.values[key]
	return value, ok, nil
}

type cpEntry struct {
	value     string
	fetchedMs int64
}

// Stands in front of the config service with the same job, reading a key, and calls
// through only when its copy is missing or older than the TTL. When the call fails, a
// stale copy is better than nothing.
type ConfigProxy struct {
	ttl      int64
	upstream *cpConfigService
	cache    map[string]cpEntry
}

func NewConfigProxy(ttlMs int64) *ConfigProxy {
	if ttlMs < 1 || ttlMs > cpMaxTtlMs {
		panic("ttl out of range")
	}
	return &ConfigProxy{ttl: ttlMs, upstream: &cpConfigService{values: map[string]string{}}, cache: map[string]cpEntry{}}
}

func (p *ConfigProxy) upstreamSet(key string, val string) {
	cpGiven(key)
	cpGiven(val)
	p.upstream.values[key] = val
}

func (p *ConfigProxy) read(key string, nowMs int64) *string {
	cpGiven(key)
	kept, have := p.cache[key]
	if have && nowMs-kept.fetchedMs < p.ttl {
		return &kept.value
	}
	value, found, err := p.upstream.fetch(key)
	if err != nil {
		if have {
			return &kept.value
		}
		return nil
	}
	if !found {
		return nil
	}
	p.cache[key] = cpEntry{value: value, fetchedMs: nowMs}
	return &value
}

func (p *ConfigProxy) upstreamDown(down bool) {
	p.upstream.down = down
}

func (p *ConfigProxy) upstreamFetches() int64 {
	return p.upstream.calls
}

// The extension round: dropping a copy before its time.
func (p *ConfigProxy) invalidate(key string) {
	cpGiven(key)
	delete(p.cache, key)
}
