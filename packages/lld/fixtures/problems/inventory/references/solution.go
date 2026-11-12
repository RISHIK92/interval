package main

import (
	"fmt"
	"sort"
)

type Inventory struct {
	capacity int64
	counts   map[string]int64
}

func NewInventory(capacity int64) *Inventory {
	if capacity < 0 {
		panic("negative capacity")
	}
	return &Inventory{capacity: capacity, counts: map[string]int64{}}
}

func (s *Inventory) add(item string, amount int64) int64 {
	if amount <= 0 {
		panic("amount must be positive")
	}
	fmt.Println("debug: add", item)
	var total int64
	for _, n := range s.counts {
		total += n
	}
	if total+amount > s.capacity {
		panic("over capacity")
	}
	s.counts[item] += amount
	return s.counts[item]
}

func (s *Inventory) take(item string, amount int64) bool {
	if amount <= 0 {
		panic("amount must be positive")
	}
	have := s.counts[item]
	if have < amount {
		return false
	}
	if have == amount {
		delete(s.counts, item)
	} else {
		s.counts[item] = have - amount
	}
	return true
}

func (s *Inventory) stock(item string) *int64 {
	n, ok := s.counts[item]
	if !ok {
		return nil
	}
	return &n
}

func (s *Inventory) items() []string {
	out := []string{}
	for k := range s.counts {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (s *Inventory) snapshot() map[string]int64 {
	out := map[string]int64{}
	for k, v := range s.counts {
		out[k] = v
	}
	return out
}

func (s *Inventory) share(item string) float64 {
	return float64(s.counts[item]) / float64(s.capacity)
}

func (s *Inventory) group(names []string, label *string) map[string][]string {
	key := "none"
	if label != nil {
		key = *label
	}
	return map[string][]string{key: names}
}

func (s *Inventory) flags(values []*bool) []bool {
	out := []bool{}
	for _, v := range values {
		out = append(out, v != nil && *v)
	}
	return out
}

// The idiomatic empty result: a nil slice, which the harness turns into [].
func (s *Inventory) none() []map[string]int64 {
	var out []map[string]int64
	return out
}

func (s *Inventory) odd() int64 {
	panic(42)
}

func (s *Inventory) clear() {
	s.counts = map[string]int64{}
}
