package main

// The pipeline owns stages, a stage owns its jobs (composition); a job only names the
// jobs it needs (dependency), all in earlier stages, so a run goes in stage order.
type Pipeline struct {
	stages  []string
	jobs    map[string][]string
	stageOf map[string]string
	needs   map[string][]string
	failing map[string]bool
	allowed map[string]bool
}

func NewPipeline() *Pipeline {
	return &Pipeline{
		jobs:    map[string][]string{},
		stageOf: map[string]string{},
		needs:   map[string][]string{},
		failing: map[string]bool{},
		allowed: map[string]bool{},
	}
}

func pipeNamed(names ...string) {
	for _, n := range names {
		if n == "" {
			panic("stage and job names are not empty")
		}
	}
}

func (p *Pipeline) known(job string) {
	pipeNamed(job)
	if _, ok := p.stageOf[job]; !ok {
		panic("unknown job")
	}
}

func (p *Pipeline) stage(name string) {
	pipeNamed(name)
	if _, ok := p.jobs[name]; ok {
		panic("stage already exists")
	}
	p.stages = append(p.stages, name)
	p.jobs[name] = []string{}
}

func (p *Pipeline) job(stage string, name string, needs []string) bool {
	pipeNamed(stage, name)
	pipeNamed(needs...)
	if _, ok := p.jobs[stage]; !ok {
		panic("unknown stage")
	}
	seen := map[string]bool{}
	for _, n := range needs {
		if seen[n] {
			panic("a need is listed twice")
		}
		seen[n] = true
	}
	if _, ok := p.stageOf[name]; ok {
		return false
	}
	earlier := map[string]bool{}
	for _, s := range p.stages {
		if s == stage {
			break
		}
		earlier[s] = true
	}
	for _, n := range needs {
		if s, ok := p.stageOf[n]; !ok || !earlier[s] {
			return false
		}
	}
	p.jobs[stage] = append(p.jobs[stage], name)
	p.stageOf[name] = stage
	p.needs[name] = append([]string{}, needs...)
	return true
}

func (p *Pipeline) fail(job string) {
	p.known(job)
	p.failing[job] = true
}

func (p *Pipeline) blocks(need, result string) bool {
	return result == "skipped" || (result == "failed" && !p.allowed[need])
}

func (p *Pipeline) run() []string {
	outcome := map[string]string{}
	out := []string{}
	for _, stage := range p.stages {
		for _, job := range p.jobs[stage] {
			result := "passed"
			if p.failing[job] {
				result = "failed"
			}
			for _, n := range p.needs[job] {
				if p.blocks(n, outcome[n]) {
					result = "skipped"
				}
			}
			outcome[job] = result
			out = append(out, job+": "+result)
		}
	}
	return out
}

func (p *Pipeline) removeStage(name string) int64 {
	pipeNamed(name)
	owned, ok := p.jobs[name]
	if !ok {
		panic("unknown stage")
	}
	mine := map[string]bool{}
	for _, job := range owned {
		mine[job] = true
	}
	for job, needs := range p.needs {
		if mine[job] {
			continue
		}
		for _, n := range needs {
			if mine[n] {
				panic("a later job needs this stage")
			}
		}
	}
	for _, job := range owned {
		delete(p.stageOf, job)
		delete(p.needs, job)
		delete(p.failing, job)
		delete(p.allowed, job)
	}
	for i, s := range p.stages {
		if s == name {
			p.stages = append(p.stages[:i:i], p.stages[i+1:]...)
			break
		}
	}
	delete(p.jobs, name)
	return int64(len(owned))
}

// The extension round: an allowed failure doesn't skip the jobs that need it.
func (p *Pipeline) allowFailure(job string) {
	p.known(job)
	p.allowed[job] = true
}
