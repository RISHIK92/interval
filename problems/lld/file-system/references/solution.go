package main

import (
	"sort"
	"strings"
	"sync"
)

type node struct {
	dir  bool
	text string
	kids map[string]*node
}

func newDir() *node { return &node{dir: true, kids: map[string]*node{}} }

type FileSystem struct {
	root *node
	// One lock for the whole tree: mv touches two directories at once, and a lock per
	// directory would need an ordering to avoid deadlock.
	mu sync.Mutex
}

func NewFileSystem() *FileSystem { return &FileSystem{root: newDir()} }

func splitPath(path string) []string {
	if !strings.HasPrefix(path, "/") {
		panic("invalid path")
	}
	out := []string{}
	for _, s := range strings.Split(path, "/") {
		switch s {
		case "", ".":
		case "..":
			if len(out) == 0 {
				panic("invalid path")
			}
			out = out[:len(out)-1]
		default:
			out = append(out, s)
		}
	}
	return out
}

func (f *FileSystem) walk(parts []string) *node {
	n := f.root
	for _, p := range parts {
		if !n.dir {
			panic("not a directory")
		}
		k, ok := n.kids[p]
		if !ok {
			panic("not found")
		}
		n = k
	}
	return n
}

func (f *FileSystem) parent(parts []string) (*node, string) {
	if len(parts) == 0 {
		panic("is a directory")
	}
	p := f.walk(parts[:len(parts)-1])
	if !p.dir {
		panic("not a directory")
	}
	return p, parts[len(parts)-1]
}

func (f *FileSystem) mkdir(path string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := f.root
	for _, p := range splitPath(path) {
		k, ok := n.kids[p]
		if !ok {
			k = newDir()
			n.kids[p] = k
		} else if !k.dir {
			panic("already exists")
		}
		n = k
	}
}

func (f *FileSystem) write(path string, text string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, name := f.parent(splitPath(path))
	if k, ok := p.kids[name]; ok && k.dir {
		panic("is a directory")
	}
	p.kids[name] = &node{text: text}
}

func (f *FileSystem) appendTo(path string, text string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, name := f.parent(splitPath(path))
	k, ok := p.kids[name]
	if ok && k.dir {
		panic("is a directory")
	}
	if !ok {
		k = &node{}
		p.kids[name] = k
	}
	k.text += text
}

func (f *FileSystem) read(path string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := f.walk(splitPath(path))
	if n.dir {
		panic("is a directory")
	}
	return n.text
}

func (f *FileSystem) ls(path string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	parts := splitPath(path)
	n := f.walk(parts)
	out := make([]string, 0, len(n.kids))
	if !n.dir {
		return append(out, parts[len(parts)-1])
	}
	for name := range n.kids {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func (f *FileSystem) rm(path string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, name := f.parent(splitPath(path))
	k, ok := p.kids[name]
	if !ok {
		panic("not found")
	}
	if k.dir && len(k.kids) > 0 {
		panic("directory not empty")
	}
	delete(p.kids, name)
}

// The extension round.
func (f *FileSystem) mv(source string, target string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	sp, tp := splitPath(source), splitPath(target)
	if len(sp) == 0 {
		panic("cannot move the root")
	}
	n := f.walk(sp)
	if len(tp) >= len(sp) && strings.Join(tp[:len(sp)], "/") == strings.Join(sp, "/") {
		panic("cannot move into itself")
	}
	tparent, tname := f.parent(tp)
	if _, ok := tparent.kids[tname]; ok {
		panic("already exists")
	}
	sparent, sname := f.parent(sp)
	delete(sparent.kids, sname)
	tparent.kids[tname] = n
}

func total(n *node) int64 {
	if !n.dir {
		return int64(len(n.text))
	}
	var sum int64
	for _, k := range n.kids {
		sum += total(k)
	}
	return sum
}

func (f *FileSystem) size(path string) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return total(f.walk(splitPath(path)))
}
