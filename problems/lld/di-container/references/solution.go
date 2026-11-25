package main

import (
	"strconv"
	"strings"
)

var diLifetimes = map[string]bool{"singleton": true, "transient": true, "scoped": true}

func diGiven(value string) {
	if value == "" {
		panic("empty")
	}
}

// How to make one service: its lifetime, what it needs, and how many it has made. Each
// instance is its service's name and number, followed by the instances it was given, so
// the string shows exactly which instances are shared.
type diProvider struct {
	service, lifetime string
	deps              []string
	made              int64
	wrappers          []string
}

func (p *diProvider) construct(given []string) string {
	p.made++
	instance := p.service + "#" + strconv.FormatInt(p.made, 10)
	if len(given) > 0 {
		instance += "(" + strings.Join(given, ",") + ")"
	}
	for _, wrapper := range p.wrappers {
		instance = wrapper + "[" + instance + "]"
	}
	return instance
}

type diKey struct {
	service     string
	inSingleton bool
}

// Services are registered with a lifetime and named dependencies, and nothing is made
// until something asks for it. The lifetime decides where an instance is kept: once for
// the container, once per scope, or nowhere (a new one every time).
type DiContainer struct {
	providers  map[string]*diProvider
	singletons map[string]string
	scopes     map[string]map[string]string
}

func NewDiContainer() *DiContainer {
	return &DiContainer{
		providers:  map[string]*diProvider{},
		singletons: map[string]string{},
		scopes:     map[string]map[string]string{},
	}
}

func (c *DiContainer) provide(service string, lifetime string, deps []string) {
	diGiven(service)
	if !diLifetimes[lifetime] {
		panic("unknown lifetime")
	}
	seen := map[string]bool{}
	for _, dep := range deps {
		diGiven(dep)
		seen[dep] = true
	}
	if len(seen) != len(deps) {
		panic("a dependency listed twice")
	}
	if _, ok := c.providers[service]; ok {
		panic("already provided")
	}
	c.providers[service] = &diProvider{service: service, lifetime: lifetime, deps: append([]string{}, deps...)}
}

func (c *DiContainer) resolve(service string, scope string) string {
	diGiven(scope)
	// Check the whole graph first, so a resolve that fails constructs nothing.
	c.check(service, false, map[string]bool{}, map[diKey]bool{})
	return c.instance(service, scope)
}

func (c *DiContainer) constructed(service string) int64 {
	return c.provider(service).made
}

func (c *DiContainer) endScope(scope string) int64 {
	diGiven(scope)
	size := int64(len(c.scopes[scope]))
	delete(c.scopes, scope)
	return size
}

// The extension round: wrapping a service without changing it.
func (c *DiContainer) decorate(service string, wrapper string) {
	diGiven(wrapper)
	p := c.provider(service)
	p.wrappers = append(p.wrappers, wrapper)
}

func (c *DiContainer) provider(service string) *diProvider {
	found, ok := c.providers[service]
	if !ok {
		panic("unknown service")
	}
	return found
}

func (c *DiContainer) check(service string, inSingleton bool, path map[string]bool, done map[diKey]bool) {
	p := c.provider(service)
	if path[service] {
		panic("a dependency cycle")
	}
	if inSingleton && p.lifetime == "scoped" {
		panic("a singleton would hold on to a scoped instance")
	}
	key := diKey{service, inSingleton}
	if done[key] {
		return
	}
	path[service] = true
	for _, dep := range p.deps {
		c.check(dep, inSingleton || p.lifetime == "singleton", path, done)
	}
	delete(path, service)
	done[key] = true
}

func (c *DiContainer) instance(service string, scope string) string {
	p := c.providers[service]
	var kept map[string]string
	if p.lifetime == "singleton" {
		kept = c.singletons
	} else if p.lifetime == "scoped" {
		if c.scopes[scope] == nil {
			c.scopes[scope] = map[string]string{}
		}
		kept = c.scopes[scope]
	}
	if existing, ok := kept[service]; ok {
		return existing
	}
	deps := []string{}
	for _, dep := range p.deps {
		deps = append(deps, c.instance(dep, scope))
	}
	built := p.construct(deps)
	if kept != nil {
		kept[service] = built
	}
	return built
}
