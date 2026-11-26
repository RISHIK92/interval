package main

import "sort"

// One link in the chain: its person is paged in turn, and when they don't acknowledge in
// time the page moves on to the next link, if there is one.
type escLevel struct {
	person string
	after  *escLevel
}

type escIncident struct {
	level  *escLevel
	holder string
	since  int64
	acked  bool
}

type Escalation struct {
	first     *escLevel
	people    map[string]bool
	timeout   int64
	incidents map[string]*escIncident
	covers    map[string]string
	now       int64
}

func NewEscalation(levels []string, ackTimeoutMs int64) *Escalation {
	people := map[string]bool{}
	for _, person := range levels {
		people[person] = true
	}
	if len(levels) == 0 || people[""] || len(people) != len(levels) || ackTimeoutMs < 1 {
		panic("bad levels or timeout")
	}
	var first *escLevel
	for i := len(levels) - 1; i >= 0; i-- {
		first = &escLevel{person: levels[i], after: first}
	}
	return &Escalation{first: first, people: people, timeout: ackTimeoutMs,
		incidents: map[string]*escIncident{}, covers: map[string]string{}}
}

func (e *Escalation) clock(nowMs int64) {
	if nowMs < e.now {
		panic("time went backwards")
	}
	e.now = nowMs
}

func (e *Escalation) paged(level *escLevel) string {
	if substitute, ok := e.covers[level.person]; ok {
		return substitute
	}
	return level.person
}

func (e *Escalation) page(incident string, nowMs int64) string {
	if _, known := e.incidents[incident]; incident == "" || known {
		panic("an empty or known incident")
	}
	e.clock(nowMs)
	holder := e.paged(e.first)
	e.incidents[incident] = &escIncident{level: e.first, holder: holder, since: nowMs}
	return holder
}

func (e *Escalation) tick(nowMs int64) []string {
	e.clock(nowMs)
	names := make([]string, 0, len(e.incidents))
	for name := range e.incidents {
		names = append(names, name)
	}
	sort.Strings(names)
	moved := []string{}
	for _, name := range names {
		incident := e.incidents[name]
		after := incident.level.after
		if incident.acked || after == nil || nowMs-incident.since < e.timeout {
			continue
		}
		incident.level = after
		incident.holder = e.paged(after)
		incident.since = nowMs
		moved = append(moved, name+" -> "+incident.holder)
	}
	return moved
}

func (e *Escalation) ack(incident string, person string, nowMs int64) bool {
	if incident == "" || person == "" {
		panic("an empty name")
	}
	e.clock(nowMs)
	found, ok := e.incidents[incident]
	if !ok || found.acked || found.holder != person {
		return false
	}
	found.acked = true
	return true
}

func (e *Escalation) holder(incident string) *string {
	if incident == "" {
		panic("an empty incident")
	}
	found, ok := e.incidents[incident]
	if !ok {
		return nil
	}
	holder := found.holder
	return &holder
}

// The extension round: holiday cover, applied whenever someone is paged from now on.
func (e *Escalation) cover(person string, substitute string) {
	if !e.people[person] || substitute == "" {
		panic("not on call, or an empty substitute")
	}
	if substitute == person {
		delete(e.covers, person)
	} else {
		e.covers[person] = substitute
	}
}
