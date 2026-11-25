package main

import (
	"sort"
	"strconv"
	"strings"
)

// A path is a list of segments: a key steps into an object, an index into an array.
type segment struct {
	key     string
	index   int
	isIndex bool
}

func parseKey(text string) segment {
	if text == "" {
		panic("not a key")
	}
	for _, c := range text {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') {
			panic("not a key")
		}
	}
	return segment{key: text}
}

func parseIndex(text string) segment {
	if text == "" || (text[0] == '0' && text != "0") {
		panic("not an index")
	}
	for _, c := range text {
		if c < '0' || c > '9' {
			panic("not an index")
		}
	}
	n, err := strconv.Atoi(text)
	if err != nil {
		panic("not an index")
	}
	return segment{index: n, isIndex: true}
}

func parse(path string) []segment {
	segments := []segment{}
	if path == "" {
		return segments
	}
	for _, part := range strings.Split(path, ".") {
		pieces := strings.Split(part, "[")
		segments = append(segments, parseKey(pieces[0]))
		for _, piece := range pieces[1:] {
			if !strings.HasSuffix(piece, "]") {
				panic("an unclosed [")
			}
			segments = append(segments, parseIndex(piece[:len(piece)-1]))
		}
	}
	return segments
}

func join(at string, s segment) string {
	if s.isIndex {
		return at + "[" + strconv.Itoa(s.index) + "]"
	}
	if at == "" {
		return s.key
	}
	return at + "." + s.key
}

// The composite: scalars, objects and arrays answer the same questions, and a branch
// answers by asking its children.
type node interface {
	child(s segment) node
	summary() string
	size() int64
	leaves(at string) []string
}

// A branch can also grow and shrink.
type branch interface {
	node
	room(s segment) bool
	attach(s segment, n node)
	detach(s segment)
}

type scalar struct{ value string }

func (*scalar) child(segment) node        { return nil }
func (v *scalar) summary() string         { return v.value }
func (*scalar) size() int64               { return 0 }
func (*scalar) leaves(at string) []string { return []string{at} }

type objectNode struct{ children map[string]node }

func newObject() *objectNode { return &objectNode{children: map[string]node{}} }

func (o *objectNode) child(s segment) node {
	if s.isIndex {
		return nil
	}
	return o.children[s.key]
}
func (o *objectNode) room(s segment) bool      { return !s.isIndex }
func (o *objectNode) attach(s segment, n node) { o.children[s.key] = n }
func (o *objectNode) detach(s segment)         { delete(o.children, s.key) }
func (o *objectNode) summary() string          { return "object(" + strconv.Itoa(len(o.children)) + ")" }
func (o *objectNode) size() int64 {
	var total int64
	for _, c := range o.children {
		total += 1 + c.size()
	}
	return total
}
func (o *objectNode) leaves(at string) []string {
	keys := make([]string, 0, len(o.children))
	for k := range o.children {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := []string{}
	for _, k := range keys {
		out = append(out, o.children[k].leaves(join(at, segment{key: k}))...)
	}
	return out
}

type arrayNode struct{ items []node }

func (a *arrayNode) child(s segment) node {
	if !s.isIndex || s.index >= len(a.items) {
		return nil
	}
	return a.items[s.index]
}

// An array only grows at its end.
func (a *arrayNode) room(s segment) bool      { return s.isIndex && s.index == len(a.items) }
func (a *arrayNode) attach(_ segment, n node) { a.items = append(a.items, n) }
func (a *arrayNode) detach(s segment)         { a.items = append(a.items[:s.index], a.items[s.index+1:]...) }
func (a *arrayNode) summary() string          { return "array(" + strconv.Itoa(len(a.items)) + ")" }
func (a *arrayNode) size() int64 {
	var total int64
	for _, item := range a.items {
		total += 1 + item.size()
	}
	return total
}
func (a *arrayNode) leaves(at string) []string {
	out := []string{}
	for i, item := range a.items {
		out = append(out, item.leaves(join(at, segment{index: i, isIndex: true}))...)
	}
	return out
}

type DocTree struct {
	root *objectNode
}

func NewDocTree() *DocTree {
	return &DocTree{root: newObject()}
}

func (d *DocTree) put(path string, val string) bool {
	segments := parse(path)
	if len(segments) == 0 || val == "" {
		panic("the root can't be a scalar, and a value isn't empty")
	}
	n, rest := d.walk(segments)
	if len(rest) > 0 {
		return grow(n, rest, &scalar{val})
	}
	v, ok := n.(*scalar)
	if !ok {
		return false
	}
	v.value = val
	return true
}

func (d *DocTree) read(path string) *string {
	n := d.find(parse(path))
	if n == nil {
		return nil
	}
	text := n.summary()
	return &text
}

func (d *DocTree) remove(path string) bool {
	segments := parse(path)
	if len(segments) == 0 {
		panic("the root stays")
	}
	last := segments[len(segments)-1]
	parent, ok := d.find(segments[:len(segments)-1]).(branch)
	if !ok || parent.child(last) == nil {
		return false
	}
	parent.detach(last)
	return true
}

func (d *DocTree) paths(prefix string) []string {
	n := d.find(parse(prefix))
	if n == nil {
		return []string{}
	}
	return n.leaves(prefix)
}

func (d *DocTree) count(path string) int64 {
	n := d.find(parse(path))
	if n == nil {
		panic("no such node")
	}
	return n.size()
}

// The extension round: a shallow merge of scalars into one object.
func (d *DocTree) merge(path string, entries map[string]string) int64 {
	segments := parse(path)
	for name, value := range entries {
		parseKey(name)
		if value == "" {
			panic("an empty value")
		}
	}
	n, rest := d.walk(segments)
	if len(rest) > 0 {
		made := newObject()
		if !grow(n, rest, made) {
			panic("the path can't be made")
		}
		n = made
	}
	target, ok := n.(*objectNode)
	if !ok {
		panic("only an object can be merged into")
	}
	var changed int64
	for name, value := range entries {
		if old, ok := target.children[name].(*scalar); ok && old.value == value {
			continue
		}
		target.children[name] = &scalar{value}
		changed++
	}
	return changed
}

// Follows the path as far as it exists: the last node reached and the segments to go.
func (d *DocTree) walk(segments []segment) (node, []segment) {
	var n node = d.root
	for i, s := range segments {
		c := n.child(s)
		if c == nil {
			return n, segments[i:]
		}
		n = c
	}
	return n, nil
}

func (d *DocTree) find(segments []segment) node {
	n, rest := d.walk(segments)
	if len(rest) > 0 {
		return nil
	}
	return n
}

// Creates the missing part of a path, each new branch an object or an array as the
// segment after it needs, or refuses without changing anything.
func grow(parent node, rest []segment, leaf node) bool {
	b, ok := parent.(branch)
	if !ok || !b.room(rest[0]) {
		return false
	}
	// Every array made here is new and empty, so it can only take index 0.
	for _, s := range rest[1:] {
		if s.isIndex && s.index != 0 {
			return false
		}
	}
	for i := 0; i+1 < len(rest); i++ {
		var made branch = newObject()
		if rest[i+1].isIndex {
			made = &arrayNode{}
		}
		b.attach(rest[i], made)
		b = made
	}
	b.attach(rest[len(rest)-1], leaf)
	return true
}
