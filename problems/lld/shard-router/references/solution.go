package main

const shardMost = 1000
const shardModulus = 1000000007

// How a key finds its shard; ok is false when this strategy has no shard for it.
type shardStrategy interface {
	shard(key string, shards int64) (shard int64, ok bool)
}

type hashModulo struct{}

func (hashModulo) shard(key string, shards int64) (int64, bool) {
	var h int64
	for i := 0; i < len(key); i++ {
		h = (h*31 + int64(key[i])) % shardModulus
	}
	return h % shards, true
}

type keyRange struct{}

func (keyRange) shard(key string, shards int64) (int64, bool) {
	// Printable ASCII split into equal ranges by the first character.
	return (int64(key[0]) - 32) * shards / 95, true
}

type directoryStrategy struct{ entries map[string]int64 }

func (d directoryStrategy) shard(key string, _ int64) (int64, bool) {
	at, ok := d.entries[key]
	return at, ok
}

// A key's place: its shard, or none.
type shardPlace struct {
	shard int64
	ok    bool
}

type ShardRouter struct {
	shards     int64
	directory  map[string]int64
	strategies map[string]shardStrategy
	strategy   shardStrategy
	tracked    map[string]bool
}

func NewShardRouter(shards int64, strategy string) *ShardRouter {
	shardCheckCount(shards)
	directory := map[string]int64{}
	r := &ShardRouter{
		shards:    shards,
		directory: directory,
		strategies: map[string]shardStrategy{
			"hash": hashModulo{}, "range": keyRange{}, "directory": directoryStrategy{directory},
		},
		tracked: map[string]bool{},
	}
	r.strategy = r.pick(strategy)
	return r
}

func (r *ShardRouter) route(key string) int64 {
	shard, ok := r.strategy.shard(shardCheckKey(key), r.shards)
	if !ok {
		panic("no directory entry")
	}
	return shard
}

func (r *ShardRouter) track(key string) {
	r.tracked[shardCheckKey(key)] = true
}

func (r *ShardRouter) assignDirectory(key string, shard int64) {
	shardCheckKey(key)
	if shard < 0 || shard >= r.shards {
		panic("no such shard")
	}
	r.directory[key] = shard
}

func (r *ShardRouter) rebalance(shards int64) int64 {
	shardCheckCount(shards)
	before := r.placement()
	r.shards = shards
	for key, at := range r.directory {
		r.directory[key] = at % shards
	}
	return r.moved(before)
}

// The extension round: switching strategy, reporting what moves.
func (r *ShardRouter) useStrategy(strategy string) int64 {
	chosen := r.pick(strategy)
	before := r.placement()
	r.strategy = chosen
	return r.moved(before)
}

func (r *ShardRouter) pick(name string) shardStrategy {
	found, ok := r.strategies[name]
	if !ok {
		panic("unknown strategy")
	}
	return found
}

func (r *ShardRouter) placement() map[string]shardPlace {
	out := map[string]shardPlace{}
	for key := range r.tracked {
		shard, ok := r.strategy.shard(key, r.shards)
		out[key] = shardPlace{shard, ok}
	}
	return out
}

func (r *ShardRouter) moved(before map[string]shardPlace) int64 {
	after := r.placement()
	var count int64
	for key := range r.tracked {
		if before[key] != after[key] {
			count++
		}
	}
	return count
}

func shardCheckCount(shards int64) {
	if shards < 1 || shards > shardMost {
		panic("shards out of range")
	}
}

func shardCheckKey(key string) string {
	if key == "" {
		panic("empty key")
	}
	return key
}
