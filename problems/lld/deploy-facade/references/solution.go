package main

func dfGiven(value string) {
	if value == "" {
		panic("empty")
	}
}

// One of the tools a deploy drives (the builder, the registry, the migrator, the
// cluster, the chat bot). Each can run a release and undo it, and can be set to fail its
// next run.
type dfSubsystem struct {
	name   string
	broken bool
}

func (s *dfSubsystem) run(release string) string {
	return s.name + " " + release
}

func (s *dfSubsystem) undo(release string) string {
	return "undo " + s.name + " " + release
}

// One call in front of five subsystems: it runs them in order, unwinds the ones that ran
// when one fails, and keeps each service's live versions.
type DeployFacade struct {
	steps []*dfSubsystem
	live  map[string][]string
}

func NewDeployFacade() *DeployFacade {
	f := &DeployFacade{live: map[string][]string{}}
	for _, name := range []string{"build", "push", "migrate", "rollout", "announce"} {
		f.steps = append(f.steps, &dfSubsystem{name: name})
	}
	return f
}

func (f *DeployFacade) deploy(service string, version string) []string {
	return f.run(service, version, true)
}

func (f *DeployFacade) breakStep(step string) {
	for _, subsystem := range f.steps {
		if subsystem.name == step {
			subsystem.broken = true
			return
		}
	}
	panic("unknown step")
}

func (f *DeployFacade) history(service string) []string {
	dfGiven(service)
	return append([]string{}, f.live[service]...)
}

func (f *DeployFacade) rollback(service string) *string {
	dfGiven(service)
	versions := f.live[service]
	if len(versions) < 2 {
		return nil
	}
	versions = versions[:len(versions)-1]
	f.live[service] = versions
	previous := versions[len(versions)-1]
	return &previous
}

// The extension round: what a deploy would do right now, with nothing changed.
func (f *DeployFacade) dryRun(service string, version string) []string {
	return f.run(service, version, false)
}

func (f *DeployFacade) run(service, version string, real bool) []string {
	dfGiven(service)
	dfGiven(version)
	release := service + "@" + version
	lines := []string{}
	ran := []*dfSubsystem{}
	for _, step := range f.steps {
		if step.broken {
			if real {
				step.broken = false
			}
			lines = append(lines, step.run(release)+" failed")
			for i := len(ran) - 1; i >= 0; i-- {
				lines = append(lines, ran[i].undo(release))
			}
			return lines
		}
		lines = append(lines, step.run(release))
		ran = append(ran, step)
	}
	if real {
		f.live[service] = append(f.live[service], version)
	}
	return lines
}
