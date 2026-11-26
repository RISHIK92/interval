package main

var cjSteps = []string{"checkout", "setup", "install", "test", "report"}
var cjHooks = map[string]bool{"setup": true, "install": true}

// A kind's own commands. setup and install are hooks: a kind that has no such step
// returns nil for it, as cjBase does.
type cjKind interface {
	setup() *string
	install() *string
	test() string
}

// The hooks' defaults, embedded by every kind.
type cjBase struct{}

func (cjBase) setup() *string   { return nil }
func (cjBase) install() *string { return nil }

func cjCommand(command string) *string { return &command }

type cjNode struct{ cjBase }

func (cjNode) setup() *string   { return cjCommand("nvm use") }
func (cjNode) install() *string { return cjCommand("npm ci") }
func (cjNode) test() string     { return "npm test" }

type cjPython struct{ cjBase }

func (cjPython) setup() *string   { return cjCommand("python -m venv .venv") }
func (cjPython) install() *string { return cjCommand("pip install -r requirements.txt") }
func (cjPython) test() string     { return "pytest" }

type cjGo struct{ cjBase }

func (cjGo) install() *string { return cjCommand("go mod download") }
func (cjGo) test() string     { return "go test ./..." }

var cjKinds = map[string]cjKind{"node": cjNode{}, "python": cjPython{}, "go": cjGo{}}

// The template: it fixes the skeleton and its rules (skipped hooks, stopping at a
// failure, report always running), and asks the kind only for its own commands.
func cjRun(kind cjKind, skipped map[string]bool, failAt string, before []string) []string {
	test := kind.test()
	checkout, report := "git checkout", "publish results"
	commands := []*string{&checkout, kind.setup(), kind.install(), &test, &report}
	log := []string{}
	failed := false
	for i, step := range cjSteps {
		if commands[i] == nil || skipped[step] || (failed && step != "report") {
			continue
		}
		for _, hook := range before {
			log = append(log, "before "+step+": "+hook)
		}
		command := *commands[i]
		if step == failAt {
			failed = true
			command += " [failed]"
		}
		log = append(log, step+": "+command)
	}
	return log
}

// Runs CI jobs of every kind through the one template, with the steps skipped and the
// commands to run before each step shared by all kinds.
type JobRunner struct {
	skipped map[string]bool
	before  []string
}

func NewJobRunner() *JobRunner {
	return &JobRunner{skipped: map[string]bool{}}
}

func (r *JobRunner) steps(kind string) []string {
	return cjRun(cjJob(kind), r.skipped, "", r.before)
}

func (r *JobRunner) skip(step string) {
	if !cjHooks[step] {
		panic("only a hook can be skipped")
	}
	r.skipped[step] = true
}

func (r *JobRunner) runJob(kind string, failAt string) []string {
	found := cjJob(kind)
	known := failAt == ""
	for _, step := range cjSteps {
		known = known || step == failAt
	}
	if !known {
		panic("unknown step")
	}
	return cjRun(found, r.skipped, failAt, r.before)
}

// The extension round: a command before every step.
func (r *JobRunner) beforeEach(command string) {
	if command == "" {
		panic("empty command")
	}
	r.before = append(r.before, command)
}

func cjJob(kind string) cjKind {
	found, known := cjKinds[kind]
	if !known {
		panic("unknown kind")
	}
	return found
}
