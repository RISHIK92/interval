package main

var treeParentKind = map[string]string{"folder": "organization", "project": "folder", "resource": "project"}

type grantKey struct{ role, member string }

type treeNode struct {
	kind     string
	parent   string
	children map[string]bool
	grants   map[grantKey]bool
	denies   map[grantKey]bool
}

func newTreeNode(kind, parent string) *treeNode {
	return &treeNode{kind: kind, parent: parent, children: map[string]bool{}, grants: map[grantKey]bool{}, denies: map[grantKey]bool{}}
}

// Nodes compose: each holds its children, and removing one takes its subtree. Grants
// associate a member with a node by name; members are never nodes. The organization's
// parent is "", which no node can be named.
type ResourceTree struct {
	org   string
	nodes map[string]*treeNode
}

func treeNamed(names ...string) {
	for _, n := range names {
		if n == "" {
			panic("names, kinds, roles and members are not empty")
		}
	}
}

func NewResourceTree(org string) *ResourceTree {
	treeNamed(org)
	return &ResourceTree{org: org, nodes: map[string]*treeNode{org: newTreeNode("organization", "")}}
}

func (t *ResourceTree) get(node string) *treeNode {
	treeNamed(node)
	found, ok := t.nodes[node]
	if !ok {
		panic("unknown node")
	}
	return found
}

func (t *ResourceTree) addNode(parent string, node string, kind string) bool {
	treeNamed(parent, node, kind)
	want, ok := treeParentKind[kind]
	if !ok {
		panic("unknown kind")
	}
	holder, ok := t.nodes[parent]
	if _, taken := t.nodes[node]; !ok || taken || holder.kind != want {
		return false
	}
	t.nodes[node] = newTreeNode(kind, parent)
	holder.children[node] = true
	return true
}

func (t *ResourceTree) attach(node string, role string, member string) {
	treeNamed(role, member)
	t.get(node).grants[grantKey{role, member}] = true
}

func (t *ResourceTree) can(member string, role string, node string) bool {
	treeNamed(member, role)
	key := grantKey{role, member}
	granted := false
	for at := t.get(node); at != nil; at = t.nodes[at.parent] {
		if at.denies[key] {
			return false
		}
		if at.grants[key] {
			granted = true
		}
	}
	return granted
}

func (t *ResourceTree) move(node string, parent string) bool {
	treeNamed(node, parent)
	moving, okNode := t.nodes[node]
	holder, okParent := t.nodes[parent]
	if !okNode || !okParent || node == t.org {
		return false
	}
	if treeParentKind[moving.kind] != holder.kind {
		return false
	}
	delete(t.nodes[moving.parent].children, node)
	holder.children[node] = true
	moving.parent = parent
	return true
}

func (t *ResourceTree) remove(node string) int64 {
	found := t.get(node)
	if node == t.org {
		panic("the organization can't be removed")
	}
	delete(t.nodes[found.parent].children, node)
	return t.drop(node)
}

func (t *ResourceTree) drop(node string) int64 {
	var count int64 = 1
	for child := range t.nodes[node].children {
		count += t.drop(child)
	}
	delete(t.nodes, node)
	return count
}

// The extension round: a deny below or above overrides every grant.
func (t *ResourceTree) deny(node string, role string, member string) {
	treeNamed(role, member)
	t.get(node).denies[grantKey{role, member}] = true
}
