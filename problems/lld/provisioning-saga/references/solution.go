package main

import (
	"slices"
	"strings"
)

const failedPrefix = "fail:"
const maxTimes = 1000

var stepNames = []string{"create-user", "create-repo", "grant-access", "send-welcome"}

// A command with its compensation. Each returns what it did, for the trail; an injected
// failure count makes the next attempts fail.
type step struct {
	name     string
	failures int64
}

func (s *step) execute() string {
	if s.failures == 0 {
		return "do:" + s.name
	}
	s.failures--
	return failedPrefix + s.name
}

func (s *step) compensate() string { return "undo:" + s.name }

// One account's run: the steps done, in order, and everything that happened.
type saga struct {
	done   []*step
	trail  []string
	status string
}

func (g *saga) resume(steps []*step, pivot *step) {
	// Done steps are skipped, so a retry carries on where the last run stopped and a
	// completed saga runs nothing.
	for _, s := range steps[len(g.done):] {
		entry := s.execute()
		g.trail = append(g.trail, entry)
		if strings.HasPrefix(entry, failedPrefix) {
			g.failed(pivot)
			return
		}
		g.done = append(g.done, s)
	}
	g.status = "completed"
}

func (g *saga) failed(pivot *step) {
	if pivot != nil && slices.Contains(g.done, pivot) {
		g.status = "pending"
		return
	}
	for i := len(g.done) - 1; i >= 0; i-- {
		g.trail = append(g.trail, g.done[i].compensate())
	}
	g.done = nil
	g.status = "compensated"
}

type ProvisioningSaga struct {
	steps     []*step
	sagas     map[string]*saga
	pivotStep *step
}

func NewProvisioningSaga() *ProvisioningSaga {
	p := &ProvisioningSaga{sagas: map[string]*saga{}}
	for _, name := range stepNames {
		p.steps = append(p.steps, &step{name: name})
	}
	return p
}

func (p *ProvisioningSaga) failStep(name string, times int64) {
	found := p.findStep(name)
	if times < 0 || times > maxTimes {
		panic("times runs from 0 to 1000")
	}
	found.failures = times
}

func (p *ProvisioningSaga) start(account string) string {
	if account == "" {
		panic("an empty account")
	}
	g, ok := p.sagas[account]
	if !ok {
		g = &saga{trail: []string{}}
		p.sagas[account] = g
		g.resume(p.steps, p.pivotStep)
	}
	return g.status
}

func (p *ProvisioningSaga) retry(account string) string {
	g := p.findSaga(account)
	g.resume(p.steps, p.pivotStep)
	return g.status
}

func (p *ProvisioningSaga) trail(account string) []string {
	return slices.Clone(p.findSaga(account).trail)
}

func (p *ProvisioningSaga) status(account string) string {
	return p.findSaga(account).status
}

// The extension round: a pivot step, past which the saga only moves forward.
func (p *ProvisioningSaga) pivot(name string) {
	p.pivotStep = p.findStep(name)
}

func (p *ProvisioningSaga) findStep(name string) *step {
	for _, s := range p.steps {
		if s.name == name {
			return s
		}
	}
	panic("no such step")
}

func (p *ProvisioningSaga) findSaga(account string) *saga {
	g, ok := p.sagas[account]
	if !ok {
		panic("no such account")
	}
	return g
}
