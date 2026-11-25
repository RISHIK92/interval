package main

import "strconv"

const incidentMaxMs = 1_000_000_000_000_000

// Owns its timeline: nothing outside the incident appends to it.
type incident struct {
	commander  string
	responders map[string]bool
	declaredAt int64
	resolved   bool
	resolvedAt int64
	lastMs     int64
	lines      []string
}

func (i *incident) write(nowMs int64, text string) {
	i.lastMs = nowMs
	i.lines = append(i.lines, strconv.FormatInt(nowMs, 10)+" "+text)
}

type IncidentRoom struct {
	incidents map[string]*incident
}

func NewIncidentRoom() *IncidentRoom {
	return &IncidentRoom{incidents: map[string]*incident{}}
}

func incidentNamed(names ...string) {
	for _, n := range names {
		if n == "" {
			panic("ids, names and notes are not empty")
		}
	}
}

func incidentTimed(nowMs int64) {
	if nowMs < 0 || nowMs > incidentMaxMs {
		panic("nowMs must be within 0 and 10^15")
	}
}

func (r *IncidentRoom) find(id string) *incident {
	incidentNamed(id)
	found, ok := r.incidents[id]
	if !ok {
		panic("unknown incident")
	}
	return found
}

func (r *IncidentRoom) at(id string, nowMs int64) *incident {
	incidentTimed(nowMs)
	found := r.find(id)
	if nowMs < found.lastMs {
		panic("time went backwards")
	}
	return found
}

func (r *IncidentRoom) declareIncident(id string, commander string, nowMs int64) {
	incidentNamed(id, commander)
	incidentTimed(nowMs)
	if _, ok := r.incidents[id]; ok {
		panic("incident already declared")
	}
	created := &incident{commander: commander, responders: map[string]bool{commander: true}, declaredAt: nowMs}
	created.write(nowMs, "declared by "+commander)
	r.incidents[id] = created
}

func (r *IncidentRoom) joinIncident(id string, responder string, nowMs int64) bool {
	incidentNamed(responder)
	found := r.at(id, nowMs)
	if found.responders[responder] {
		return false
	}
	found.responders[responder] = true
	found.write(nowMs, responder+" joined")
	return true
}

func (r *IncidentRoom) note(id string, author string, text string, nowMs int64) bool {
	incidentNamed(author, text)
	found := r.at(id, nowMs)
	if !found.responders[author] || found.resolved {
		return false
	}
	found.write(nowMs, author+": "+text)
	return true
}

func (r *IncidentRoom) handOff(id string, to string, nowMs int64) bool {
	incidentNamed(to)
	found := r.at(id, nowMs)
	if !found.responders[to] || to == found.commander {
		return false
	}
	found.write(nowMs, found.commander+" handed off to "+to)
	found.commander = to
	return true
}

func (r *IncidentRoom) timeline(id string) []string {
	return append([]string{}, r.find(id).lines...)
}

// The extension round: resolving closes the incident to notes.
func (r *IncidentRoom) resolve(id string, nowMs int64) bool {
	found := r.at(id, nowMs)
	if found.resolved {
		return false
	}
	found.resolved = true
	found.resolvedAt = nowMs
	found.write(nowMs, "resolved")
	return true
}

func (r *IncidentRoom) durationMs(id string) int64 {
	found := r.find(id)
	if !found.resolved {
		panic("not resolved yet")
	}
	return found.resolvedAt - found.declaredAt
}
