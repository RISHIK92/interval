package main

import "sort"

var runnerCapabilities = map[string]bool{"build": true, "test": true, "deploy": true, "gpu": true}

func runnerGiven(value string) {
	if value == "" {
		panic("empty name")
	}
}

func knownCapabilities(capabilities []string) map[string]bool {
	out := map[string]bool{}
	for _, c := range capabilities {
		if !runnerCapabilities[c] {
			panic("unknown capability")
		}
		out[c] = true
	}
	return out
}

// There is deliberately no Runner interface with build, test, deploy and gpu methods, which
// would force a build-only runner to stub a deploy. A runner holds only the capabilities it
// really has, and a job is matched against just the ones it needs.
type poolRunner struct {
	name         string
	capabilities map[string]bool
	job          *string
	draining     bool
}

func (r *poolRunner) takes(needs map[string]bool) bool {
	if r.job != nil || r.draining {
		return false
	}
	for n := range needs {
		if !r.capabilities[n] {
			return false
		}
	}
	return true
}

type RunnerPool struct {
	runners []*poolRunner // in the order they were added
	jobs    map[string]*poolRunner
}

func NewRunnerPool() *RunnerPool {
	return &RunnerPool{jobs: map[string]*poolRunner{}}
}

func (p *RunnerPool) find(name string) int {
	for i, r := range p.runners {
		if r.name == name {
			return i
		}
	}
	return -1
}

func (p *RunnerPool) addRunner(name string, capabilities []string) {
	runnerGiven(name)
	if p.find(name) >= 0 {
		panic("runner already in the pool")
	}
	p.runners = append(p.runners, &poolRunner{name: name, capabilities: knownCapabilities(capabilities)})
}

func (p *RunnerPool) assign(job string, needs []string) *string {
	runnerGiven(job)
	wanted := knownCapabilities(needs)
	if _, running := p.jobs[job]; running {
		panic("job already running")
	}
	for _, r := range p.runners {
		if r.takes(wanted) {
			r.job = &job
			p.jobs[job] = r
			return &r.name
		}
	}
	return nil
}

func (p *RunnerPool) finish(job string) bool {
	runnerGiven(job)
	r, ok := p.jobs[job]
	if !ok {
		return false
	}
	delete(p.jobs, job)
	r.job = nil
	p.leaveIfDrained(r)
	return true
}

func (p *RunnerPool) busy() []string {
	out := []string{}
	for _, r := range p.jobs {
		out = append(out, r.name)
	}
	sort.Strings(out)
	return out
}

// The extension round: a runner on its way out.
func (p *RunnerPool) drain(name string) {
	runnerGiven(name)
	i := p.find(name)
	if i < 0 {
		panic("no such runner")
	}
	p.runners[i].draining = true
	p.leaveIfDrained(p.runners[i])
}

func (p *RunnerPool) leaveIfDrained(r *poolRunner) {
	if r.draining && r.job == nil {
		i := p.find(r.name)
		p.runners = append(p.runners[:i], p.runners[i+1:]...)
	}
}
