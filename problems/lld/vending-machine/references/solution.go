package main

import "sync"

var coinList = [4]int64{100, 25, 10, 5}

type slotEntry struct {
	item  string
	price int64
	count int64
}

type VendingMachine struct {
	slots   map[string]*slotEntry
	coins   map[int64]int64
	pending map[int64]int64
	// One lock for the whole machine: a purchase reads and moves the slot, the credit
	// and the coin inventory together.
	mu sync.Mutex
}

func NewVendingMachine() *VendingMachine {
	return &VendingMachine{
		slots:   map[string]*slotEntry{},
		coins:   map[int64]int64{100: 0, 25: 0, 10: 0, 5: 0},
		pending: map[int64]int64{100: 0, 25: 0, 10: 0, 5: 0},
	}
}

func (v *VendingMachine) slot(slot string) *slotEntry {
	entry, ok := v.slots[slot]
	if !ok {
		panic("unknown slot")
	}
	return entry
}

func (v *VendingMachine) coin(coin int64) {
	if _, ok := v.coins[coin]; !ok {
		panic("not a coin")
	}
}

func (v *VendingMachine) credit() int64 {
	var sum int64
	for c, n := range v.pending {
		sum += c * n
	}
	return sum
}

func (v *VendingMachine) stock(slot string, item string, price int64, count int64) {
	if slot == "" || item == "" || price <= 0 || count < 0 {
		panic("invalid stock")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	v.slots[slot] = &slotEntry{item, price, count}
}

func (v *VendingMachine) insert(coin int64) int64 {
	v.coin(coin)
	v.mu.Lock()
	defer v.mu.Unlock()
	v.pending[coin]++
	return v.credit()
}

func (v *VendingMachine) balance() int64 {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.credit()
}

func (v *VendingMachine) buy(slot string) []int64 {
	v.mu.Lock()
	defer v.mu.Unlock()
	entry := v.slot(slot)
	if entry.count == 0 {
		panic("sold out")
	}
	credit := v.credit()
	if credit < entry.price {
		panic("not enough credit")
	}
	avail := map[int64]int64{}
	for _, c := range coinList {
		avail[c] = v.coins[c] + v.pending[c]
	}
	rest := credit - entry.price
	change := []int64{}
	for _, c := range coinList {
		take := rest / c
		if avail[c] < take {
			take = avail[c]
		}
		for i := int64(0); i < take; i++ {
			change = append(change, c)
		}
		avail[c] -= take
		rest -= take * c
	}
	if rest != 0 {
		panic("no exact change")
	}
	v.coins = avail
	v.pending = map[int64]int64{100: 0, 25: 0, 10: 0, 5: 0}
	entry.count--
	return change
}

func (v *VendingMachine) refund() []int64 {
	v.mu.Lock()
	defer v.mu.Unlock()
	out := []int64{}
	for _, c := range coinList {
		for i := int64(0); i < v.pending[c]; i++ {
			out = append(out, c)
		}
	}
	v.pending = map[int64]int64{100: 0, 25: 0, 10: 0, 5: 0}
	return out
}

func (v *VendingMachine) inventory(slot string) int64 {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.slot(slot).count
}

func (v *VendingMachine) item(slot string) string {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.slot(slot).item
}

func (v *VendingMachine) restockCoins(coin int64, count int64) {
	v.coin(coin)
	if count <= 0 {
		panic("count must be positive")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	v.coins[coin] += count
}

func (v *VendingMachine) coinStock(coin int64) int64 {
	v.coin(coin)
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.coins[coin]
}
