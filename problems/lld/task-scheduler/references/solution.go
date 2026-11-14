package main

import "sync"

type task struct {
	priority int64
	deps     []string
	// queued, running, done or cancelled.
	state string
}

type TaskScheduler struct {
	tasks map[string]*task
	// Ids in the order they were added, which breaks priority ties.
	order []string
	mu    sync.Mutex
}

func NewTaskScheduler() *TaskScheduler {
	return &TaskScheduler{tasks: map[string]*task{}}
}

func (s *TaskScheduler) isReady(t *task) bool {
	if t.state != "queued" {
		return false
	}
	for _, d := range t.deps {
		if s.tasks[d].state != "done" {
			return false
		}
	}
	return true
}

func (s *TaskScheduler) add(id string, priority int64, deps []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tasks[id]; ok {
		panic("duplicate id")
	}
	for _, d := range deps {
		if _, ok := s.tasks[d]; !ok {
			panic("unknown dependency")
		}
	}
	s.tasks[id] = &task{priority: priority, deps: append([]string{}, deps...), state: "queued"}
	s.order = append(s.order, id)
}

func (s *TaskScheduler) next() *string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var best *task
	var bestID string
	for _, id := range s.order {
		t := s.tasks[id]
		// Strictly greater, so the earliest added keeps a tie.
		if s.isReady(t) && (best == nil || t.priority > best.priority) {
			best, bestID = t, id
		}
	}
	if best == nil {
		return nil
	}
	best.state = "running"
	return &bestID
}

func (s *TaskScheduler) complete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tasks[id]
	if !ok || t.state != "running" {
		panic("not running")
	}
	t.state = "done"
}

func (s *TaskScheduler) status(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tasks[id]
	if !ok {
		panic("unknown id")
	}
	if t.state == "queued" {
		if s.isReady(t) {
			return "ready"
		}
		return "waiting"
	}
	return t.state
}

// The extension round.
func (s *TaskScheduler) cancel(id string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tasks[id]
	if !ok {
		panic("unknown id")
	}
	if t.state == "done" {
		panic("already done")
	}
	if t.state == "cancelled" {
		return 0
	}
	// Dependencies are always added first, so one pass in order finds every dependent.
	gone := map[string]bool{id: true}
	t.state = "cancelled"
	for _, other := range s.order {
		o := s.tasks[other]
		if o.state != "queued" {
			continue
		}
		for _, d := range o.deps {
			if gone[d] {
				o.state = "cancelled"
				gone[other] = true
				break
			}
		}
	}
	return int64(len(gone))
}
