package main

import "sort"

// A cached value and its usage history. Every policy reads the same history, so
// switching never loses it.
type cacheEntry struct {
	value, entered, used, uses int64
}

// Each strategy only ranks entries; the lowest rank is evicted.
type evictionPolicy interface {
	rank(e *cacheEntry) [2]int64
}

type lruPolicy struct{}
type lfuPolicy struct{}
type fifoPolicy struct{}

func (lruPolicy) rank(e *cacheEntry) [2]int64  { return [2]int64{e.used, 0} }
func (lfuPolicy) rank(e *cacheEntry) [2]int64  { return [2]int64{e.uses, e.used} }
func (fifoPolicy) rank(e *cacheEntry) [2]int64 { return [2]int64{e.entered, 0} }

var evictionPolicies = map[string]evictionPolicy{"lru": lruPolicy{}, "lfu": lfuPolicy{}, "fifo": fifoPolicy{}}

func rankBefore(a, b [2]int64) bool {
	if a[0] != b[0] {
		return a[0] < b[0]
	}
	return a[1] < b[1]
}

type EvictingCache struct {
	capacity int64
	policy   evictionPolicy
	entries  map[string]*cacheEntry
	pinned   map[string]bool
	clock    int64
}

func NewEvictingCache(capacity int64, policy string) *EvictingCache {
	chosen, ok := evictionPolicies[policy]
	if capacity < 1 || !ok {
		panic("bad capacity or policy")
	}
	return &EvictingCache{capacity: capacity, policy: chosen, entries: map[string]*cacheEntry{}, pinned: map[string]bool{}}
}

func (c *EvictingCache) use(entry *cacheEntry) {
	c.clock++
	entry.used = c.clock
	entry.uses++
}

func (c *EvictingCache) evict() {
	victim := ""
	for key, entry := range c.entries {
		if c.pinned[key] {
			continue
		}
		if victim == "" || rankBefore(c.policy.rank(entry), c.policy.rank(c.entries[victim])) {
			victim = key
		}
	}
	if victim == "" {
		panic("every key is pinned")
	}
	delete(c.entries, victim)
}

func (c *EvictingCache) put(key string, val int64) {
	if key == "" {
		panic("an empty key")
	}
	if entry, ok := c.entries[key]; ok {
		entry.value = val
		c.use(entry)
		return
	}
	if int64(len(c.entries)) >= c.capacity {
		c.evict()
	}
	c.clock++
	c.entries[key] = &cacheEntry{value: val, entered: c.clock, used: c.clock, uses: 1}
}

func (c *EvictingCache) lookup(key string) *int64 {
	if key == "" {
		panic("an empty key")
	}
	entry, ok := c.entries[key]
	if !ok {
		return nil
	}
	c.use(entry)
	value := entry.value
	return &value
}

func (c *EvictingCache) keys() []string {
	out := make([]string, 0, len(c.entries))
	for key := range c.entries {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func (c *EvictingCache) switchPolicy(policy string) {
	chosen, ok := evictionPolicies[policy]
	if !ok {
		panic("unknown policy")
	}
	c.policy = chosen
}

// The extension round: a pinned key is passed over by every policy.
func (c *EvictingCache) pinKey(key string) {
	if _, ok := c.entries[key]; !ok {
		panic("not cached")
	}
	c.pinned[key] = true
}
