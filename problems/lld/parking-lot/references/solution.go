package main

import (
	"container/heap"
	"regexp"
	"strconv"
	"sync"
)

// Free spot numbers as a min-heap: the lowest is always first.
type spotHeap []int64

func (h spotHeap) Len() int           { return len(h) }
func (h spotHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h spotHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *spotHeap) Push(x any)        { *h = append(*h, x.(int64)) }
func (h *spotHeap) Pop() any {
	old := *h
	x := old[len(old)-1]
	*h = old[:len(old)-1]
	return x
}

type parkedCar struct {
	kind   string
	number int64
}

func (c parkedCar) label() string {
	prefix := "L"
	if c.kind == "small" {
		prefix = "S"
	}
	return prefix + strconv.FormatInt(c.number, 10)
}

type ParkingLot struct {
	spots map[string]*spotHeap
	cars  map[string]parkedCar
	// The extension round: spots out of use, and how many of each size exist.
	blocked map[parkedCar]bool
	counts  map[string]int64
	mu      sync.Mutex
}

func NewParkingLot(small int64, large int64) *ParkingLot {
	if small < 0 || large < 0 {
		panic("negative spot count")
	}
	fill := func(n int64) *spotHeap {
		h := spotHeap{}
		for i := int64(1); i <= n; i++ {
			h = append(h, i)
		}
		return &h
	}
	return &ParkingLot{spots: map[string]*spotHeap{"small": fill(small), "large": fill(large)}, cars: map[string]parkedCar{}, blocked: map[parkedCar]bool{}, counts: map[string]int64{"small": small, "large": large}}
}

func (p *ParkingLot) known(size string) *spotHeap {
	h, ok := p.spots[size]
	if !ok {
		panic("unknown size")
	}
	return h
}

func (p *ParkingLot) park(plate string, size string) *string {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.known(size)
	if _, ok := p.cars[plate]; ok {
		panic("already parked")
	}
	kinds := []string{"large"}
	if size == "small" {
		kinds = []string{"small", "large"}
	}
	for _, kind := range kinds {
		h := p.spots[kind]
		if h.Len() == 0 {
			continue
		}
		car := parkedCar{kind, heap.Pop(h).(int64)}
		p.cars[plate] = car
		l := car.label()
		return &l
	}
	return nil
}

func (p *ParkingLot) leave(plate string) *string {
	p.mu.Lock()
	defer p.mu.Unlock()
	car, ok := p.cars[plate]
	if !ok {
		return nil
	}
	delete(p.cars, plate)
	heap.Push(p.spots[car.kind], car.number)
	l := car.label()
	return &l
}

func (p *ParkingLot) where(plate string) *string {
	p.mu.Lock()
	defer p.mu.Unlock()
	car, ok := p.cars[plate]
	if !ok {
		return nil
	}
	l := car.label()
	return &l
}

var spotPattern = regexp.MustCompile(`^([SL])([1-9][0-9]{0,17})$`)

func (p *ParkingLot) spotOf(spot string) parkedCar {
	m := spotPattern.FindStringSubmatch(spot)
	if m == nil {
		panic("unknown spot")
	}
	kind := "large"
	if m[1] == "S" {
		kind = "small"
	}
	number, err := strconv.ParseInt(m[2], 10, 64)
	if err != nil || number > p.counts[kind] {
		panic("unknown spot")
	}
	return parkedCar{kind, number}
}

// The extension round: a spot out of use, and back.
func (p *ParkingLot) block(spot string) bool {
	s := p.spotOf(spot)
	p.mu.Lock()
	defer p.mu.Unlock()
	h := p.spots[s.kind]
	for i, n := range *h {
		if n == s.number {
			heap.Remove(h, i)
			p.blocked[s] = true
			return true
		}
	}
	return false
}

func (p *ParkingLot) unblock(spot string) bool {
	s := p.spotOf(spot)
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.blocked[s] {
		return false
	}
	delete(p.blocked, s)
	heap.Push(p.spots[s.kind], s.number)
	return true
}

func (p *ParkingLot) free(size string) int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return int64(p.known(size).Len())
}
