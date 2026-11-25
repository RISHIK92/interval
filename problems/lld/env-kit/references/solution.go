package main

import "strconv"

// An abstract factory: one family's way of making each kind of component. The kit only
// ever asks the family in use, so every component it makes belongs together.
type family interface {
	name() string
	queue() string
	store() string
	clock() string
}

type localFamily struct{}

func (localFamily) name() string  { return "local" }
func (localFamily) queue() string { return "inmem-queue" }
func (localFamily) store() string { return "sqlite-store" }
func (localFamily) clock() string { return "fake-clock" }

type ciFamily struct{}

func (ciFamily) name() string  { return "ci" }
func (ciFamily) queue() string { return "valkey-queue" }
func (ciFamily) store() string { return "postgres-store" }
func (ciFamily) clock() string { return "fixed-clock" }

type stagingFamily struct{}

func (stagingFamily) name() string  { return "staging" }
func (stagingFamily) queue() string { return "sqs-queue" }
func (stagingFamily) store() string { return "rds-store" }
func (stagingFamily) clock() string { return "system-clock" }

// A family defined at run time: its components are named after its prefix.
type prefixedFamily struct{ called, prefix string }

func (p prefixedFamily) name() string  { return p.called }
func (p prefixedFamily) queue() string { return p.prefix + "-queue" }
func (p prefixedFamily) store() string { return p.prefix + "-store" }
func (p prefixedFamily) clock() string { return p.prefix + "-clock" }

// Each kind is one of the factory's methods; the kit never names a concrete family.
var envKinds = map[string]func(family) string{
	"queue": family.queue,
	"store": family.store,
	"clock": family.clock,
}

type EnvKit struct {
	families map[string]family
	current  family
	made     map[string]string // component id -> family name
}

func NewEnvKit() *EnvKit {
	k := &EnvKit{families: map[string]family{}, made: map[string]string{}}
	for _, f := range []family{localFamily{}, ciFamily{}, stagingFamily{}} {
		k.families[f.name()] = f
	}
	return k
}

func (k *EnvKit) use(name string) {
	found, ok := k.families[name]
	if !ok {
		panic("unknown family")
	}
	k.current = found
}

func (k *EnvKit) component(kind string) string {
	build, ok := envKinds[kind]
	if !ok {
		panic("unknown kind")
	}
	if k.current == nil {
		panic("no family in use")
	}
	id := build(k.current) + "#" + strconv.Itoa(len(k.made)+1)
	k.made[id] = k.current.name()
	return id
}

func (k *EnvKit) wire(a string, b string) bool {
	if a == b {
		panic("a component can't be wired to itself")
	}
	return k.family(a) == k.family(b)
}

func (k *EnvKit) family(componentId string) string {
	found, ok := k.made[componentId]
	if !ok {
		panic("unknown component")
	}
	return found
}

// The extension round: a family that isn't built in.
func (k *EnvKit) defineFamily(name string, prefix string) {
	if name == "" || prefix == "" {
		panic("empty")
	}
	if _, ok := k.families[name]; ok {
		panic("family exists")
	}
	k.families[name] = prefixedFamily{called: name, prefix: prefix}
}
