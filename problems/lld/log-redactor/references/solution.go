package main

import "strings"

// One kind of secret: a rule rewrites the words it matches and counts them. The
// redactor only decides which rules run and in what order.
type rule interface {
	apply(words []string) int64
}

type emails struct{}

func (emails) apply(words []string) int64 {
	var hits int64
	for i, word := range words {
		local, domain, found := strings.Cut(word, "@")
		if found && local != "" && !strings.Contains(domain, "@") && len(domain) > 2 &&
			strings.Contains(domain[1:len(domain)-1], ".") {
			words[i] = "[email]"
			hits++
		}
	}
	return hits
}

type cards struct{}

func allDigits(word string) bool {
	for _, c := range word {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func (cards) apply(words []string) int64 {
	var hits int64
	for i, word := range words {
		if len(word) >= 13 && len(word) <= 19 && allDigits(word) {
			words[i] = strings.Repeat("*", len(word)-4) + word[len(word)-4:]
			hits++
		}
	}
	return hits
}

// Masks the word that comes right after a given word, left to right.
type afterWord struct{ prefix, mask string }

func (a afterWord) apply(words []string) int64 {
	var hits int64
	for i := 0; i+1 < len(words); i++ {
		if words[i] == a.prefix && words[i+1] != "" {
			words[i+1] = a.mask
			hits++
		}
	}
	return hits
}

type Redactor struct {
	rules   map[string]rule
	enabled []string
	counts  map[string]int64
}

func NewRedactor() *Redactor {
	r := &Redactor{rules: map[string]rule{}, counts: map[string]int64{}}
	r.add("email", emails{})
	r.add("card", cards{})
	r.add("bearer", afterWord{"Bearer", "[token]"})
	return r
}

func (r *Redactor) add(name string, found rule) {
	r.rules[name] = found
	r.counts[name] = 0
}

func (r *Redactor) known(name string) {
	if _, ok := r.rules[name]; !ok {
		panic("unknown rule")
	}
}

func (r *Redactor) enabledAt(name string) int {
	for i, n := range r.enabled {
		if n == name {
			return i
		}
	}
	return -1
}

func (r *Redactor) enable(name string) {
	r.known(name)
	if r.enabledAt(name) < 0 {
		r.enabled = append(r.enabled, name)
	}
}

func (r *Redactor) disable(name string) {
	r.known(name)
	if at := r.enabledAt(name); at >= 0 {
		r.enabled = append(r.enabled[:at], r.enabled[at+1:]...)
	}
}

func (r *Redactor) redact(line string) string {
	words := strings.Split(line, " ")
	for _, name := range r.enabled {
		r.counts[name] += r.rules[name].apply(words)
	}
	return strings.Join(words, " ")
}

func (r *Redactor) hits(name string) int64 {
	r.known(name)
	return r.counts[name]
}

// The extension round: a new rule is one more entry, run like any other.
func (r *Redactor) maskAfter(name string, prefix string) {
	if _, taken := r.rules[name]; name == "" || taken {
		panic("a rule needs a new, non-empty name")
	}
	if prefix == "" || strings.Contains(prefix, " ") {
		panic("the prefix is one word")
	}
	r.add(name, afterWord{prefix, "[" + name + "]"})
}
