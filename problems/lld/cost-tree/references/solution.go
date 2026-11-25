package main

import (
	"sort"
	"strconv"
)

func costGiven(value string) {
	if value == "" {
		panic("empty")
	}
}

// A component: a service (a leaf) or a unit (a composite). Anyone asking for a total asks
// the node, whichever it is.
type costNode interface {
	base() *costBase
	total() int64
	children() []costNode
}

type costBase struct {
	name   string
	parent *costUnit
	shared int64 // cents allocated to this node from above (the extension)
}

func (b *costBase) base() *costBase { return b }

type costService struct {
	costBase
	cents int64
}

func (s *costService) total() int64         { return s.cents + s.shared }
func (s *costService) children() []costNode { return []costNode{} }

type costUnit struct {
	costBase
	members map[string]costNode
}

func (u *costUnit) total() int64 {
	sum := u.shared
	for _, child := range u.members {
		sum += child.total()
	}
	return sum
}

func (u *costUnit) children() []costNode {
	out := []costNode{}
	for _, child := range u.members {
		out = append(out, child)
	}
	return out
}

// Whether this unit is node itself or somewhere under it.
func (u *costUnit) within(node costNode) bool {
	if costNode(u) == node {
		return true
	}
	return u.parent != nil && u.parent.within(node)
}

type CostTree struct {
	nodes map[string]costNode
}

func NewCostTree(root string) *CostTree {
	costGiven(root)
	return &CostTree{nodes: map[string]costNode{root: &costUnit{costBase: costBase{name: root}, members: map[string]costNode{}}}}
}

func (t *CostTree) unit(parent string, name string) bool {
	at := t.unitAt(parent)
	costGiven(name)
	return t.attach(at, &costUnit{costBase: costBase{name: name, parent: at}, members: map[string]costNode{}})
}

func (t *CostTree) service(parent string, name string, cents int64) bool {
	at := t.unitAt(parent)
	costGiven(name)
	if cents < 0 {
		panic("a cost is never negative")
	}
	return t.attach(at, &costService{costBase: costBase{name: name, parent: at}, cents: cents})
}

func (t *CostTree) total(node string) int64 {
	return t.find(node).total()
}

func (t *CostTree) move(node string, parent string) bool {
	moving := t.find(node)
	to := t.unitAt(parent)
	b := moving.base()
	if b.parent == nil {
		panic("the root stays where it is")
	}
	if b.parent == to || to.within(moving) {
		return false
	}
	delete(b.parent.members, b.name)
	b.parent = to
	to.members[b.name] = moving
	return true
}

func (t *CostTree) top(node string, n int64) []string {
	found := t.find(node)
	if n < 0 {
		panic("n is never negative")
	}
	ranked := found.children()
	sort.Slice(ranked, func(i, j int) bool {
		a, b := ranked[i], ranked[j]
		if a.total() != b.total() {
			return a.total() > b.total()
		}
		return a.base().name < b.base().name
	})
	out := []string{}
	for i, child := range ranked {
		if int64(i) >= n {
			break
		}
		out = append(out, child.base().name+" "+strconv.FormatInt(child.total(), 10))
	}
	return out
}

// The extension round: a cost shared by everything directly under a unit.
func (t *CostTree) sharedCost(node string, cents int64) {
	found := t.unitAt(node)
	if cents < 0 {
		panic("a cost is never negative")
	}
	children := found.children()
	if len(children) == 0 {
		panic("nothing to share with")
	}
	sort.Slice(children, func(i, j int) bool { return children[i].base().name < children[j].base().name })
	count := int64(len(children))
	for i, child := range children {
		share := cents / count
		if int64(i) < cents%count {
			share++
		}
		child.base().shared += share
	}
}

func (t *CostTree) attach(at *costUnit, node costNode) bool {
	name := node.base().name
	if _, taken := t.nodes[name]; taken {
		return false
	}
	at.members[name] = node
	t.nodes[name] = node
	return true
}

func (t *CostTree) find(name string) costNode {
	found, ok := t.nodes[name]
	if !ok {
		panic("no such node")
	}
	return found
}

func (t *CostTree) unitAt(name string) *costUnit {
	found, ok := t.find(name).(*costUnit)
	if !ok {
		panic("a service has nothing under it")
	}
	return found
}
