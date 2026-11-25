package main

import "sort"

// Each kind's required properties.
var stackRequired = map[string][]string{
	"bucket":   {"region"},
	"queue":    {"region"},
	"database": {"engine", "size"},
	"service":  {"image", "port"},
	"worker":   {"image"},
	"balancer": {"port"},
}

type stackResource struct {
	kind, name string
	props      map[string]string
	needs      []string // resources this one depends on
	neededBy   []string // resources that depend on this one
}

type stackPart struct {
	kind, name string
	props      map[string]string
}

// An abstract factory for a family of resources that belong together. A recipe names its
// parts after the name it's given and says how they depend on each other.
type recipe interface {
	resources(name string) []stackPart
	links(name string) [][2]string
}

type webRecipe struct{}

func (webRecipe) resources(name string) []stackPart {
	return []stackPart{
		{"balancer", name + "-lb", map[string]string{"port": "443"}},
		{"service", name + "-app", map[string]string{"image": name + ":latest", "port": "8080"}},
		{"database", name + "-db", map[string]string{"engine": "postgres", "size": "small"}},
	}
}

func (webRecipe) links(name string) [][2]string {
	return [][2]string{{name + "-lb", name + "-app"}, {name + "-app", name + "-db"}}
}

type workerRecipe struct{}

func (workerRecipe) resources(name string) []stackPart {
	return []stackPart{
		{"queue", name + "-jobs", map[string]string{"region": "us-east-1"}},
		{"worker", name + "-worker", map[string]string{"image": name + ":latest"}},
	}
}

func (workerRecipe) links(name string) [][2]string {
	return [][2]string{{name + "-worker", name + "-jobs"}}
}

var stackRecipes = map[string]recipe{"web": webRecipe{}, "worker": workerRecipe{}}

func stackGiven(value string) {
	if value == "" {
		panic("empty")
	}
}

// A builder: resources and dependencies accumulate step by step, by hand or a recipe at a
// time, and nothing is ordered until the plan is asked for. Dependencies never form a
// cycle, because a link that would close one is refused when it's added.
type StackBuilder struct {
	stack     string
	resources map[string]*stackResource
}

func NewStackBuilder(name string) *StackBuilder {
	stackGiven(name)
	return &StackBuilder{stack: name, resources: map[string]*stackResource{}}
}

func (s *StackBuilder) resource(kind string, name string, props map[string]string) bool {
	if _, ok := stackRequired[kind]; !ok {
		panic("unknown kind")
	}
	stackGiven(name)
	copied := map[string]string{}
	for key, value := range props {
		stackGiven(key)
		stackGiven(value)
		copied[key] = value
	}
	if _, taken := s.resources[name]; taken {
		return false
	}
	s.resources[name] = &stackResource{kind: kind, name: name, props: copied}
	return true
}

func (s *StackBuilder) dependsOn(a string, b string) bool {
	first, second := s.known(a), s.known(b)
	if a == b {
		panic("a resource can't depend on itself")
	}
	for _, need := range first.needs {
		if need == b {
			return false
		}
	}
	if s.reachable(b)[a] {
		return false
	}
	first.needs = append(first.needs, b)
	second.neededBy = append(second.neededBy, a)
	return true
}

func (s *StackBuilder) preset(recipeName string, name string) int64 {
	found, ok := stackRecipes[recipeName]
	if !ok {
		panic("unknown recipe")
	}
	stackGiven(name)
	parts := found.resources(name)
	for _, part := range parts {
		if _, taken := s.resources[part.name]; taken {
			return 0
		}
	}
	for _, part := range parts {
		s.resource(part.kind, part.name, part.props)
	}
	for _, link := range found.links(name) {
		s.dependsOn(link[0], link[1])
	}
	return int64(len(parts))
}

func (s *StackBuilder) validate() []string {
	problems := []string{}
	for _, r := range s.resources {
		for _, prop := range stackRequired[r.kind] {
			if _, ok := r.props[prop]; !ok {
				problems = append(problems, r.name+": missing "+prop)
			}
		}
	}
	sort.Strings(problems)
	return problems
}

func (s *StackBuilder) plan() []string {
	if len(s.validate()) > 0 {
		panic("the stack isn't valid")
	}
	return s.order(
		func(r *stackResource) []string { return r.needs },
		func(r *stackResource) []string { return r.neededBy },
	)
}

// The extension round: tearing the stack down.
func (s *StackBuilder) destroyPlan() []string {
	return s.order(
		func(r *stackResource) []string { return r.neededBy },
		func(r *stackResource) []string { return r.needs },
	)
}

func (s *StackBuilder) known(name string) *stackResource {
	found, ok := s.resources[name]
	if !ok {
		panic("unknown resource")
	}
	return found
}

// Every resource `start` depends on, directly or not.
func (s *StackBuilder) reachable(start string) map[string]bool {
	seen := map[string]bool{start: true}
	reached := []string{start}
	for i := 0; i < len(reached); i++ {
		for _, need := range s.resources[reached[i]].needs {
			if !seen[need] {
				seen[need] = true
				reached = append(reached, need)
			}
		}
	}
	return seen
}

// Kahn's algorithm: a resource comes once everything `before` it has, and among those
// ready, the smallest name goes first.
func (s *StackBuilder) order(before, after func(*stackResource) []string) []string {
	waiting := map[string]int{}
	ready := []string{}
	for name, r := range s.resources {
		waiting[name] = len(before(r))
		if waiting[name] == 0 {
			ready = append(ready, name)
		}
	}
	sort.Strings(ready)
	out := []string{}
	for range s.resources {
		resource := s.resources[ready[0]]
		ready = ready[1:]
		out = append(out, resource.kind+" "+s.stack+"/"+resource.name)
		for _, name := range after(resource) {
			waiting[name]--
			if waiting[name] == 0 {
				// Kept sorted, so the next resource is always the first.
				at := sort.SearchStrings(ready, name)
				ready = append(ready, "")
				copy(ready[at+1:], ready[at:])
				ready[at] = name
			}
		}
	}
	return out
}
