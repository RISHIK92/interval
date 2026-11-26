package main

import "strings"

// A subscriber: it keeps a local cache and drops a key when it hears it changed.
type appNode struct {
	cache map[string]string
	// The bus version when it went offline; meaningful only while offline.
	downAt   int
	offline  bool
	prefixes []string // none means it hears every key
}

func (n *appNode) hears(key string) bool {
	if len(n.prefixes) == 0 {
		return true
	}
	for _, p := range n.prefixes {
		if strings.HasPrefix(key, p) {
			return true
		}
	}
	return false
}

func (n *appNode) invalidate(key string) { delete(n.cache, key) }

// The publisher: every write is numbered and announced to the nodes online.
type InvalidationBus struct {
	nodes map[string]*appNode
	log   []string // the key of each write, version 1 first
}

func NewInvalidationBus() *InvalidationBus {
	return &InvalidationBus{nodes: map[string]*appNode{}}
}

func (b *InvalidationBus) join(node string) {
	if _, ok := b.nodes[node]; node == "" || ok {
		panic("empty or joined")
	}
	b.nodes[node] = &appNode{cache: map[string]string{}}
}

func (b *InvalidationBus) cacheLocal(node string, key string, val string) {
	n := b.serving(node)
	if key == "" || val == "" || !n.hears(key) {
		panic("empty or outside the keyspace")
	}
	n.cache[key] = val
}

func (b *InvalidationBus) write(key string) int64 {
	if key == "" {
		panic("empty key")
	}
	b.log = append(b.log, key)
	// A node never caches a key outside its keyspace, so dropping it there is moot.
	for _, n := range b.nodes {
		if !n.offline {
			n.invalidate(key)
		}
	}
	return int64(len(b.log))
}

func (b *InvalidationBus) cached(node string, key string) *string {
	n := b.serving(node)
	if key == "" {
		panic("empty key")
	}
	if val, ok := n.cache[key]; ok {
		return &val
	}
	return nil
}

func (b *InvalidationBus) offline(node string, down bool) {
	n := b.find(node)
	if down == n.offline {
		return
	}
	if down {
		n.downAt = len(b.log)
		n.offline = true
		return
	}
	// It can't know which keys changed while it was away, only that some did.
	for _, key := range b.log[n.downAt:] {
		if n.hears(key) {
			n.cache = map[string]string{}
			break
		}
	}
	n.offline = false
}

// The extension round: a node hears only the keys under its prefixes.
func (b *InvalidationBus) keyspace(node string, prefix string) int64 {
	n := b.find(node)
	if prefix == "" {
		panic("empty prefix")
	}
	known := false
	for _, p := range n.prefixes {
		known = known || p == prefix
	}
	if !known {
		n.prefixes = append(n.prefixes, prefix)
	}
	var dropped int64
	for key := range n.cache {
		if !n.hears(key) {
			delete(n.cache, key)
			dropped++
		}
	}
	return dropped
}

func (b *InvalidationBus) find(node string) *appNode {
	n, ok := b.nodes[node]
	if !ok {
		panic("unknown node")
	}
	return n
}

func (b *InvalidationBus) serving(node string) *appNode {
	n := b.find(node)
	if n.offline {
		panic("the node is offline")
	}
	return n
}
