package main

import (
	"sort"
	"strings"
)

// A component: a rule (a leaf) or a group (a composite). Callers evaluate, count and mute
// either the same way, without asking which one they hold.
type alertNode interface {
	base() *alertBase
	// Adds the paths of this node's unmuted rules that fire.
	firing(metrics map[string]int64, out *[]string)
	count() int64
}

type alertBase struct {
	name   string
	parent *alertGroup
	muted  bool
}

func (b *alertBase) base() *alertBase { return b }

func (b *alertBase) path() string {
	if b.parent == nil {
		return "/"
	}
	above := b.parent.path()
	if above == "/" {
		return "/" + b.name
	}
	return above + "/" + b.name
}

type alertRule struct {
	alertBase
	metric    string
	threshold int64
}

func (r *alertRule) firing(metrics map[string]int64, out *[]string) {
	value, ok := metrics[r.metric]
	if !r.muted && ok && value > r.threshold {
		*out = append(*out, r.path())
	}
}

func (r *alertRule) count() int64 { return 1 }

type alertGroup struct {
	alertBase
	children map[string]alertNode
}

func newAlertGroup(name string, parent *alertGroup) *alertGroup {
	return &alertGroup{alertBase: alertBase{name: name, parent: parent}, children: map[string]alertNode{}}
}

func (g *alertGroup) firing(metrics map[string]int64, out *[]string) {
	// A muted group silences everything under it, whatever their own flags say.
	if g.muted {
		return
	}
	for _, child := range g.children {
		child.firing(metrics, out)
	}
}

func (g *alertGroup) count() int64 {
	var total int64
	for _, child := range g.children {
		total += child.count()
	}
	return total
}

func alertCheckName(name string) {
	if name == "" || strings.Contains(name, "/") {
		panic("a name is non-empty and has no slash")
	}
}

type AlertTree struct {
	root *alertGroup
}

func NewAlertTree() *AlertTree {
	return &AlertTree{root: newAlertGroup("", nil)}
}

func (t *AlertTree) group(parent string, name string) bool {
	at := t.groupAt(parent)
	alertCheckName(name)
	return t.attach(at, name, func() alertNode { return newAlertGroup(name, at) })
}

func (t *AlertTree) rule(parent string, name string, metric string, threshold int64) bool {
	at := t.groupAt(parent)
	alertCheckName(name)
	if metric == "" {
		panic("empty metric")
	}
	return t.attach(at, name, func() alertNode {
		return &alertRule{alertBase: alertBase{name: name, parent: at}, metric: metric, threshold: threshold}
	})
}

func (t *AlertTree) mute(node string, on bool) bool {
	found := t.find(node).base()
	if found.muted == on {
		return false
	}
	found.muted = on
	return true
}

func (t *AlertTree) firing(metrics map[string]int64) []string {
	out := []string{}
	t.root.firing(metrics, &out)
	sort.Strings(out)
	return out
}

func (t *AlertTree) count(node string) int64 {
	return t.find(node).count()
}

// The extension round: moving a subtree, with its mutes.
func (t *AlertTree) moveNode(node string, parent string) bool {
	moving := t.find(node)
	to := t.groupAt(parent)
	b := moving.base()
	if b.parent == nil {
		panic("the root stays where it is")
	}
	// A group can't go under itself or anything below it: that would cut it off.
	inside := strings.HasPrefix(to.path()+"/", b.path()+"/")
	if _, taken := to.children[b.name]; inside || taken {
		return false
	}
	delete(b.parent.children, b.name)
	b.parent = to
	to.children[b.name] = moving
	return true
}

func (t *AlertTree) attach(at *alertGroup, name string, build func() alertNode) bool {
	if _, taken := at.children[name]; taken {
		return false
	}
	at.children[name] = build()
	return true
}

func (t *AlertTree) find(path string) alertNode {
	if path == "/" {
		return t.root
	}
	if !strings.HasPrefix(path, "/") {
		panic("a path starts with a slash")
	}
	var at alertNode = t.root
	for _, part := range strings.Split(path[1:], "/") {
		group, ok := at.(*alertGroup)
		if !ok {
			panic("no such node")
		}
		next, ok := group.children[part]
		if !ok {
			panic("no such node")
		}
		at = next
	}
	return at
}

func (t *AlertTree) groupAt(path string) *alertGroup {
	found, ok := t.find(path).(*alertGroup)
	if !ok {
		panic("a rule has no children")
	}
	return found
}
