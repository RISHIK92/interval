package main

import "sort"

// Each package keeps the packages it uses, in declared order, and the reverse links to
// its dependents. Dependencies must already exist, so the graph never has a cycle.
type PackageGraph struct {
	deps   map[string][]string
	users  map[string]map[string]bool
	pinned map[string]bool
}

func NewPackageGraph() *PackageGraph {
	return &PackageGraph{deps: map[string][]string{}, users: map[string]map[string]bool{}, pinned: map[string]bool{}}
}

func pkgNamed(names ...string) {
	for _, n := range names {
		if n == "" {
			panic("package names are not empty")
		}
	}
}

func (g *PackageGraph) usersOf(pkg string) map[string]bool {
	pkgNamed(pkg)
	found, ok := g.users[pkg]
	if !ok {
		panic("unknown package")
	}
	return found
}

func (g *PackageGraph) add(pkg string, deps []string) bool {
	pkgNamed(pkg)
	pkgNamed(deps...)
	seen := map[string]bool{}
	for _, d := range deps {
		if seen[d] {
			panic("a dependency is listed twice")
		}
		seen[d] = true
	}
	if _, ok := g.deps[pkg]; ok {
		return false
	}
	for _, d := range deps {
		if _, ok := g.deps[d]; !ok {
			return false
		}
	}
	g.deps[pkg] = append([]string{}, deps...)
	g.users[pkg] = map[string]bool{}
	for _, d := range deps {
		g.users[d][pkg] = true
	}
	return true
}

func (g *PackageGraph) remove(pkg string) bool {
	pkgNamed(pkg)
	found, ok := g.users[pkg]
	if !ok || len(found) > 0 {
		return false
	}
	for _, d := range g.deps[pkg] {
		delete(g.users[d], pkg)
	}
	delete(g.deps, pkg)
	delete(g.users, pkg)
	delete(g.pinned, pkg)
	return true
}

func (g *PackageGraph) dependents(pkg string) []string {
	out := []string{}
	for p := range g.usersOf(pkg) {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

func (g *PackageGraph) installOrder(pkg string) []string {
	g.usersOf(pkg)
	order := []string{}
	listed := map[string]bool{}
	var visit func(p string)
	visit = func(p string) {
		if listed[p] {
			return
		}
		for _, d := range g.deps[p] {
			visit(d)
		}
		listed[p] = true
		order = append(order, p)
	}
	visit(pkg)
	return order
}

// The extension round: pinned packages are never unused.
func (g *PackageGraph) pin(pkg string) {
	g.usersOf(pkg)
	g.pinned[pkg] = true
}

func (g *PackageGraph) unused() []string {
	out := []string{}
	for p, users := range g.users {
		if len(users) == 0 && !g.pinned[p] {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
}
