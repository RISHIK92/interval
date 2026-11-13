package main

import (
	"fmt"
	"sort"
	"sync"
)

const maxValue = 1_000_000

type order struct {
	side  string
	price int64
	qty   int64
	state string
}

type OrderBook struct {
	// Open orders per side: price -> ids in time priority, oldest first.
	levels map[string]map[int64][]string
	// Every id ever accepted. Ids are never reused.
	orders map[string]*order
	// The extension round: all quantity matched so far.
	matched int64
	mu      sync.Mutex
}

func NewOrderBook() *OrderBook {
	return &OrderBook{
		levels: map[string]map[int64][]string{"buy": {}, "sell": {}},
		orders: map[string]*order{},
	}
}

func checkSide(side string) {
	if side != "buy" && side != "sell" {
		panic("side must be buy or sell")
	}
}

func (b *OrderBook) open(id string) *order {
	o, ok := b.orders[id]
	if !ok {
		panic("unknown id")
	}
	if o.state != "open" {
		panic("order is not open")
	}
	return o
}

// prices lists a side's levels, best first.
func (b *OrderBook) prices(side string) []int64 {
	out := make([]int64, 0, len(b.levels[side]))
	for p := range b.levels[side] {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool {
		if side == "buy" {
			return out[i] > out[j]
		}
		return out[i] < out[j]
	})
	return out
}

func (b *OrderBook) unlink(id string, o *order) {
	queue := b.levels[o.side][o.price]
	for i, other := range queue {
		if other == id {
			queue = append(queue[:i:i], queue[i+1:]...)
			break
		}
	}
	if len(queue) == 0 {
		delete(b.levels[o.side], o.price)
	} else {
		b.levels[o.side][o.price] = queue
	}
}

func (b *OrderBook) place(id string, side string, price int64, qty int64) []string {
	checkSide(side)
	if price < 1 || price > maxValue {
		panic("price out of range")
	}
	if qty < 1 || qty > maxValue {
		panic("quantity out of range")
	}
	if id == "" {
		panic("empty id")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.orders[id]; ok {
		panic("duplicate id")
	}
	other := "buy"
	if side == "buy" {
		other = "sell"
	}
	fills := []string{}
	for qty > 0 {
		prices := b.prices(other)
		if len(prices) == 0 {
			break
		}
		best := prices[0]
		if (side == "buy" && best > price) || (side == "sell" && best < price) {
			break
		}
		queue := b.levels[other][best]
		makerID := queue[0]
		maker := b.orders[makerID]
		took := min(qty, maker.qty)
		fills = append(fills, fmt.Sprintf("%s:%d:%d", makerID, best, took))
		qty -= took
		maker.qty -= took
		b.matched += took
		if maker.qty == 0 {
			maker.state = "filled"
			if len(queue) == 1 {
				delete(b.levels[other], best)
			} else {
				b.levels[other][best] = queue[1:]
			}
		}
	}
	if qty > 0 {
		b.orders[id] = &order{side, price, qty, "open"}
		b.levels[side][price] = append(b.levels[side][price], id)
	} else {
		b.orders[id] = &order{side, price, 0, "filled"}
	}
	return fills
}

func (b *OrderBook) cancel(id string) int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	o := b.open(id)
	b.unlink(id, o)
	left := o.qty
	o.qty = 0
	o.state = "cancelled"
	return left
}

func (b *OrderBook) remaining(id string) *int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	o, ok := b.orders[id]
	if !ok || o.state != "open" {
		return nil
	}
	q := o.qty
	return &q
}

func (b *OrderBook) best(side string) *int64 {
	checkSide(side)
	b.mu.Lock()
	defer b.mu.Unlock()
	prices := b.prices(side)
	if len(prices) == 0 {
		return nil
	}
	return &prices[0]
}

func (b *OrderBook) depth(side string, levels int64) []int64 {
	checkSide(side)
	if levels < 0 {
		panic("negative levels")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	out := []int64{}
	for i, p := range b.prices(side) {
		if int64(i) >= levels {
			break
		}
		total := int64(0)
		for _, id := range b.levels[side][p] {
			total += b.orders[id].qty
		}
		out = append(out, p, total)
	}
	return out
}

func (b *OrderBook) modify(id string, qty int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	o := b.open(id)
	if qty < 1 || qty > maxValue {
		panic("quantity out of range")
	}
	if qty > o.qty {
		// Growing an order costs its place in the queue.
		b.unlink(id, o)
		b.levels[o.side][o.price] = append(b.levels[o.side][o.price], id)
	}
	o.qty = qty
}

func (b *OrderBook) traded() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.matched
}
