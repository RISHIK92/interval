package main

import "sort"

func lazyLetterOrDigit(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
}

func lazyLower(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c - 'A' + 'a'
	}
	return c
}

// Runs of ASCII letters and digits, lowercased.
func lazyTerms(text string) map[string]bool {
	terms := map[string]bool{}
	word := []byte{}
	for i := 0; i <= len(text); i++ {
		if i < len(text) && lazyLetterOrDigit(text[i]) {
			word = append(word, lazyLower(text[i]))
		} else if len(word) > 0 {
			terms[string(word)] = true
			word = word[:0]
		}
	}
	return terms
}

// What callers see: the real index and its proxy answer the same calls.
type searchIndex interface {
	addDoc(id string, text string)
	search(term string) []string
	removeDoc(id string) bool
}

// The real subject: each term maps to the documents that contain it. Building it reads
// every document, which is the work the proxy puts off.
type invertedIndex struct {
	postings map[string]map[string]bool
	docs     map[string]map[string]bool
}

func newInvertedIndex(pending map[string]string) *invertedIndex {
	ix := &invertedIndex{postings: map[string]map[string]bool{}, docs: map[string]map[string]bool{}}
	for id, text := range pending {
		ix.addDoc(id, text)
	}
	return ix
}

func (ix *invertedIndex) addDoc(id string, text string) {
	ix.removeDoc(id)
	terms := lazyTerms(text)
	ix.docs[id] = terms
	for term := range terms {
		if ix.postings[term] == nil {
			ix.postings[term] = map[string]bool{}
		}
		ix.postings[term][id] = true
	}
}

func (ix *invertedIndex) search(term string) []string {
	lowered := []byte(term)
	for i := range lowered {
		lowered[i] = lazyLower(lowered[i])
	}
	ids := []string{}
	for id := range ix.postings[string(lowered)] {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func (ix *invertedIndex) removeDoc(id string) bool {
	terms, ok := ix.docs[id]
	if !ok {
		return false
	}
	delete(ix.docs, id)
	for term := range terms {
		delete(ix.postings[term], id)
	}
	return true
}

// A virtual proxy: it answers like the index, but holds only the raw documents until the
// first search needs the real one. After that, every change goes straight to the real
// index, one document at a time, so it's never built twice.
type LazyIndex struct {
	pending    map[string]string
	index      *invertedIndex
	buildCount int64
}

var _ searchIndex = (*LazyIndex)(nil)

func NewLazyIndex() *LazyIndex {
	return &LazyIndex{pending: map[string]string{}}
}

func (l *LazyIndex) real() *invertedIndex {
	if l.index == nil {
		l.index = newInvertedIndex(l.pending)
		l.buildCount++
	}
	return l.index
}

func (l *LazyIndex) addDoc(id string, text string) {
	if id == "" || text == "" {
		panic("empty")
	}
	if l.index == nil {
		l.pending[id] = text
	} else {
		l.index.addDoc(id, text)
	}
}

func (l *LazyIndex) search(term string) []string {
	if term == "" {
		panic("a term is letters and digits")
	}
	for i := 0; i < len(term); i++ {
		if !lazyLetterOrDigit(term[i]) {
			panic("a term is letters and digits")
		}
	}
	return l.real().search(term)
}

func (l *LazyIndex) builds() int64 {
	return l.buildCount
}

func (l *LazyIndex) indexed() int64 {
	if l.index == nil {
		return 0
	}
	return int64(len(l.index.docs))
}

// The extension round: documents leave without a rebuild either.
func (l *LazyIndex) removeDoc(id string) bool {
	if id == "" {
		panic("empty")
	}
	if l.index == nil {
		_, ok := l.pending[id]
		delete(l.pending, id)
		return ok
	}
	return l.index.removeDoc(id)
}
