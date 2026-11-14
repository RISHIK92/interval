package main

import (
	"sort"
	"strconv"
	"sync"
)

type ElevatorSystem struct {
	top   int64
	at    []int64
	stops []map[int64]bool
	// The extension round: elevators out of service.
	out []bool
	mu  sync.Mutex
}

func NewElevatorSystem(elevators int64, floors int64) *ElevatorSystem {
	if elevators < 1 || floors < 1 {
		panic("need an elevator and a floor")
	}
	e := &ElevatorSystem{top: floors, at: make([]int64, elevators), out: make([]bool, elevators)}
	for i := int64(0); i < elevators; i++ {
		e.stops = append(e.stops, map[int64]bool{})
	}
	return e
}

func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func (e *ElevatorSystem) elevator(i int64) {
	if i < 0 || i >= int64(len(e.at)) {
		panic("unknown elevator")
	}
}

func (e *ElevatorSystem) floor(f int64) {
	if f < 0 || f > e.top {
		panic("unknown floor")
	}
}

func (e *ElevatorSystem) sorted(i int) []int64 {
	list := []int64{}
	for s := range e.stops[i] {
		list = append(list, s)
	}
	sort.Slice(list, func(a, b int) bool { return list[a] < list[b] })
	return list
}

func (e *ElevatorSystem) target(i int) int64 {
	list := e.sorted(i)
	best := list[0]
	for _, s := range list {
		if abs(s-e.at[i]) < abs(best-e.at[i]) {
			best = s
		}
	}
	return best
}

// Callers hold the lock.
func (e *ElevatorSystem) dispatch(floor int64) int {
	best := -1
	var bestCost int64
	for i := range e.at {
		if e.out[i] {
			continue
		}
		if e.stops[i][floor] {
			return i
		}
		cost := abs(e.at[i]-floor) + int64(len(e.stops[i]))
		if best == -1 || cost < bestCost {
			best, bestCost = i, cost
		}
	}
	e.stops[best][floor] = true
	return best
}

func (e *ElevatorSystem) request(floor int64) int64 {
	e.floor(floor)
	e.mu.Lock()
	defer e.mu.Unlock()
	return int64(e.dispatch(floor))
}

func (e *ElevatorSystem) press(elevator int64, floor int64) bool {
	e.elevator(elevator)
	e.floor(floor)
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.out[elevator] {
		panic("out of service")
	}
	if e.stops[elevator][floor] {
		return false
	}
	e.stops[elevator][floor] = true
	return true
}

func (e *ElevatorSystem) step() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	opened := []string{}
	for i := range e.at {
		if len(e.stops[i]) == 0 {
			continue
		}
		target := e.target(i)
		if target > e.at[i] {
			e.at[i]++
		} else if target < e.at[i] {
			e.at[i]--
		}
		if e.stops[i][e.at[i]] {
			delete(e.stops[i], e.at[i])
			opened = append(opened, strconv.Itoa(i)+":"+strconv.FormatInt(e.at[i], 10))
		}
	}
	return opened
}

func (e *ElevatorSystem) status(elevator int64) string {
	e.elevator(elevator)
	e.mu.Lock()
	defer e.mu.Unlock()
	i := int(elevator)
	here := strconv.FormatInt(e.at[i], 10)
	if e.out[i] {
		return here + " out -"
	}
	if len(e.stops[i]) == 0 {
		return here + " idle -"
	}
	target := e.target(i)
	state := "here"
	if target > e.at[i] {
		state = "up"
	} else if target < e.at[i] {
		state = "down"
	}
	list := ""
	for n, s := range e.sorted(i) {
		if n > 0 {
			list += ","
		}
		list += strconv.FormatInt(s, 10)
	}
	return here + " " + state + " " + list
}

func (e *ElevatorSystem) outOfService(elevator int64) bool {
	e.elevator(elevator)
	e.mu.Lock()
	defer e.mu.Unlock()
	i := int(elevator)
	if e.out[i] {
		return false
	}
	live := 0
	for _, o := range e.out {
		if !o {
			live++
		}
	}
	if live == 1 {
		panic("last elevator in service")
	}
	e.out[i] = true
	pending := e.sorted(i)
	e.stops[i] = map[int64]bool{}
	for _, floor := range pending {
		e.dispatch(floor)
	}
	return true
}
