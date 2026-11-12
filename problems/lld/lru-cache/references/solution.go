package main

import (
	"container/list"
	"sync"
)

type lruEntry struct {
	key   string
	value int64
}

type LRUCache struct {
	capacity int64
	// Most recently used at the front.
	order *list.List
	index map[string]*list.Element
	mu    sync.Mutex
}

func NewLRUCache(capacity int64) *LRUCache {
	if capacity < 1 {
		panic("capacity must be at least 1")
	}
	return &LRUCache{capacity: capacity, order: list.New(), index: map[string]*list.Element{}}
}

func (c *LRUCache) lookup(key string) *int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.index[key]
	if !ok {
		return nil
	}
	c.order.MoveToFront(e)
	v := e.Value.(*lruEntry).value
	return &v
}

func (c *LRUCache) put(key string, value int64) {
	if value < 0 {
		panic("negative value")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.index[key]; ok {
		e.Value.(*lruEntry).value = value
		c.order.MoveToFront(e)
		return
	}
	c.index[key] = c.order.PushFront(&lruEntry{key, value})
	if int64(c.order.Len()) > c.capacity {
		oldest := c.order.Back()
		c.order.Remove(oldest)
		delete(c.index, oldest.Value.(*lruEntry).key)
	}
}

func (c *LRUCache) size() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return int64(c.order.Len())
}

// The extension round.
func (c *LRUCache) resize(capacity int64) {
	if capacity < 1 {
		panic("capacity must be at least 1")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.capacity = capacity
	for int64(c.order.Len()) > capacity {
		oldest := c.order.Back()
		c.order.Remove(oldest)
		delete(c.index, oldest.Value.(*lruEntry).key)
	}
}

func (c *LRUCache) peek(key string) *int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.index[key]
	if !ok {
		return nil
	}
	v := e.Value.(*lruEntry).value
	return &v
}

func (c *LRUCache) keys() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := []string{}
	for e := c.order.Front(); e != nil; e = e.Next() {
		out = append(out, e.Value.(*lruEntry).key)
	}
	return out
}
