package main

import (
	"strconv"
	"strings"
)

const (
	maxTier    = 100
	maxPauseMs = 1_000_000_000
	maxMs      = 1_000_000_000_000
	maxEvery   = 10_000
)

// A subscription at one moment. Copied by value, so a snapshot (a memento) can't change
// later; a nil *subState stands for a subscription not created yet.
type subState struct {
	status      string
	tier        int64
	pausedUntil int64
}

func shown(s *subState, now int64) string {
	if s == nil {
		return "none"
	}
	if s.status == "active" && now < s.pausedUntil {
		return "paused:" + strconv.FormatInt(s.tier, 10)
	}
	return s.status + ":" + strconv.FormatInt(s.tier, 10)
}

type event struct {
	at   int64
	name string
	arg  int64
}

func present(s *subState) subState {
	if s == nil {
		panic("only created comes first")
	}
	return *s
}

// What each event does to a state, by its kind.
var applyEvent = map[string]func(s *subState, e event) subState{
	"created": func(_ *subState, e event) subState { return subState{"active", e.arg, e.at} },
	"upgraded": func(s *subState, e event) subState {
		next := present(s)
		next.tier = e.arg
		return next
	},
	"paused": func(s *subState, e event) subState {
		next := present(s)
		next.pausedUntil = e.at + e.arg
		return next
	},
	"cancelled": func(s *subState, _ event) subState {
		next := present(s)
		next.status = "cancelled"
		return next
	},
}

func running(s *subState, now int64) bool { return strings.HasPrefix(shown(s, now), "active:") }

// A request: its argument's range, and the rule it's checked by against the current
// state. If it's allowed, it becomes an event of `kind`.
type command struct {
	kind      string
	low, high int64
	allowed   func(s *subState, arg, now int64) bool
}

func (c command) valid(arg int64) bool { return c.low <= arg && arg <= c.high }

var commands = map[string]command{
	"create": {"created", 1, maxTier, func(s *subState, _, _ int64) bool { return s == nil }},
	"upgrade": {"upgraded", 1, maxTier, func(s *subState, arg, now int64) bool {
		return running(s, now) && s != nil && arg > s.tier
	}},
	"pause":  {"paused", 1, maxPauseMs, func(s *subState, _, now int64) bool { return running(s, now) }},
	"cancel": {"cancelled", 0, 0, func(s *subState, _, _ int64) bool { return s != nil && s.status == "active" }},
}

type snapshot struct {
	count int
	state subState
}

// One subscription's events, its current state, and snapshots.
type stream struct {
	events    []event
	current   *subState
	snapshots []snapshot
}

type SubscriptionLedger struct {
	streams  map[string]*stream
	every    int // 0: no snapshots yet
	replayed int64
	last     int64
	// An upcaster: an old event name and the newer name it's read under.
	renamed map[string]string
	kinds   map[string]string // current name -> kind
}

func NewSubscriptionLedger() *SubscriptionLedger {
	l := &SubscriptionLedger{streams: map[string]*stream{}, renamed: map[string]string{}, kinds: map[string]string{}}
	for kind := range applyEvent {
		l.kinds[kind] = kind
	}
	return l
}

func (l *SubscriptionLedger) handle(name string, sub string, arg int64, nowMs int64) bool {
	c, ok := commands[name]
	if !ok || sub == "" || !c.valid(arg) {
		panic("an unknown command, an empty sub or a bad arg")
	}
	if nowMs < l.last || nowMs > maxMs {
		panic("time runs forward, up to 10^12")
	}
	l.last = nowMs
	s, ok := l.streams[sub]
	if !ok {
		s = &stream{}
		l.streams[sub] = s
	}
	if !c.allowed(s.current, arg, nowMs) {
		return false
	}
	e := event{nowMs, l.nameOf(c.kind), arg}
	s.events = append(s.events, e)
	state := applyEvent[c.kind](s.current, e)
	s.current = &state
	if l.every > 0 && len(s.events)%l.every == 0 {
		s.snapshots = append(s.snapshots, snapshot{len(s.events), state})
	}
	return true
}

func (l *SubscriptionLedger) events(sub string) []string {
	out := []string{}
	for _, e := range l.stream(sub).events {
		out = append(out, strconv.FormatInt(e.at, 10)+":"+l.read(e.name)+":"+strconv.FormatInt(e.arg, 10))
	}
	return out
}

func (l *SubscriptionLedger) stateAt(sub string, nowMs int64) string {
	s := l.stream(sub)
	if nowMs < 0 || nowMs > maxMs {
		panic("a time runs from 0 to 10^12")
	}
	covered := 0
	var state *subState
	for _, snap := range s.snapshots {
		if s.events[snap.count-1].at <= nowMs {
			covered = snap.count
			kept := snap.state
			state = &kept
		}
	}
	for _, e := range s.events[covered:] {
		if e.at > nowMs {
			break
		}
		next := applyEvent[l.kinds[l.read(e.name)]](state, e)
		state = &next
		l.replayed++
	}
	return shown(state, nowMs)
}

func (l *SubscriptionLedger) snapshotEvery(n int64) {
	if n < 1 || n > maxEvery {
		panic("n runs from 1 to 10^4")
	}
	l.every = int(n)
}

func (l *SubscriptionLedger) replays() int64 { return l.replayed }

// The extension round: old events read under a new schema name.
func (l *SubscriptionLedger) upcast(eventName string, newName string) {
	kind, ok := l.kinds[eventName]
	if !ok || newName == "" || strings.Trim(newName, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") != "" {
		panic("not a current name, or a bad new name")
	}
	_, current := l.kinds[newName]
	_, old := l.renamed[newName]
	if current || old {
		panic("a name is never used twice")
	}
	l.renamed[eventName] = newName
	delete(l.kinds, eventName)
	l.kinds[newName] = kind
}

func (l *SubscriptionLedger) nameOf(kind string) string {
	for name, k := range l.kinds {
		if k == kind {
			return name
		}
	}
	panic("every kind has a name")
}

func (l *SubscriptionLedger) read(name string) string {
	// Each name is renamed at most once and never reused, so this ends.
	for i := 0; i < len(l.renamed); i++ {
		if next, ok := l.renamed[name]; ok {
			name = next
		}
	}
	return name
}

func (l *SubscriptionLedger) stream(sub string) *stream {
	if sub == "" {
		panic("an empty sub")
	}
	if s, ok := l.streams[sub]; ok {
		return s
	}
	return &stream{}
}
