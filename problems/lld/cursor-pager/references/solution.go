package main

import (
	"sort"
)

const cpMaxPageSize = 1000

func cpCheckItem(item string) {
	if item == "" {
		panic("empty item")
	}
}

// An iterator over the shared, sorted items. It remembers the last item it returned, not
// a position, so items inserted around it never make it skip or repeat one.
type cpWalk struct {
	items *[]string
	last  *string
}

func (w *cpWalk) at() int {
	if w.last == nil {
		return 0
	}
	items := *w.items
	return sort.Search(len(items), func(i int) bool { return items[i] > *w.last })
}

func (w *cpWalk) hasNext() bool {
	return w.at() < len(*w.items)
}

func (w *cpWalk) next() string {
	if !w.hasNext() {
		panic("no more items")
	}
	item := (*w.items)[w.at()]
	w.last = &item
	return item
}

// A sorted result set, walked one item at a time or a page at a time. A page's cursor is
// the last item seen, so the next page starts after that item wherever it is now.
type ResultPager struct {
	items []string
	size  int
	walk  *cpWalk
}

func NewResultPager(items []string, pageSize int64) *ResultPager {
	if pageSize < 1 || pageSize > cpMaxPageSize {
		panic("bad page size")
	}
	seen := map[string]bool{}
	for _, item := range items {
		cpCheckItem(item)
		seen[item] = true
	}
	if len(seen) != len(items) {
		panic("an item listed twice")
	}
	p := &ResultPager{items: append([]string{}, items...), size: int(pageSize)}
	// Go compares strings byte by byte: character code order.
	sort.Strings(p.items)
	p.walk = &cpWalk{items: &p.items}
	return p
}

func (p *ResultPager) hasNext() bool {
	return p.walk.hasNext()
}

func (p *ResultPager) next() string {
	return p.walk.next()
}

func (p *ResultPager) page(cursor string) []string {
	start := p.after(cursor)
	end := start + p.size
	if end > len(p.items) {
		end = len(p.items)
	}
	return append([]string{}, p.items[start:end]...)
}

func (p *ResultPager) nextCursor(cursor string) *string {
	end := p.after(cursor) + p.size
	if end < len(p.items) {
		item := p.items[end-1]
		return &item
	}
	return nil
}

// The extension round: the result set grows while it's being walked.
func (p *ResultPager) insertItem(item string) {
	cpCheckItem(item)
	at := sort.SearchStrings(p.items, item)
	if at < len(p.items) && p.items[at] == item {
		panic("already there")
	}
	p.items = append(p.items, "")
	copy(p.items[at+1:], p.items[at:])
	p.items[at] = item
}

// Where the page after the cursor starts: "" is the start of the results.
func (p *ResultPager) after(cursor string) int {
	if cursor == "" {
		return 0
	}
	at := sort.SearchStrings(p.items, cursor)
	if at == len(p.items) || p.items[at] != cursor {
		panic("unknown cursor")
	}
	return at + 1
}
