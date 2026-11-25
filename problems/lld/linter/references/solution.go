package main

import (
	"sort"
	"strconv"
	"strings"
)

// One check over one line. The linter only knows this, so a new rule is a new type and an
// entry in lintRules, and no existing rule or the linter itself is edited.
type lintRule interface {
	flags(line string) bool
}

func lintUnused(param int64) {
	if param != 0 {
		panic("this rule takes no parameter")
	}
}

type maxLineLength struct{ limit int64 }

func (r maxLineLength) flags(line string) bool { return int64(len(line)) > r.limit }

type noTabs struct{}

func (noTabs) flags(line string) bool { return strings.Contains(line, "\t") }

type noTrailingSpaces struct{}

func (noTrailingSpaces) flags(line string) bool { return strings.HasSuffix(line, " ") }

var lintRules = map[string]func(param int64) lintRule{
	"max-line-length": func(param int64) lintRule {
		if param < 1 {
			panic("a maximum is at least 1")
		}
		return maxLineLength{param}
	},
	"no-tabs":            func(param int64) lintRule { lintUnused(param); return noTabs{} },
	"no-trailing-spaces": func(param int64) lintRule { lintUnused(param); return noTrailingSpaces{} },
}

// The extension round's rule: written and added without touching the ones above.
type bannedWords struct{ words map[string]bool }

func (r *bannedWords) flags(line string) bool {
	for word := range r.words {
		if strings.Contains(line, word) {
			return true
		}
	}
	return false
}

type Linter struct {
	rules  map[string]lintRule
	banned *bannedWords
}

func NewLinter() *Linter {
	return &Linter{rules: map[string]lintRule{}}
}

func (l *Linter) enable(rule string, param int64) {
	made, ok := lintRules[rule]
	if !ok {
		panic("unknown rule")
	}
	l.rules[rule] = made(param)
}

func (l *Linter) lint(lines []string) []string {
	names := l.enabled()
	out := []string{}
	for i, line := range lines {
		for _, name := range names {
			if l.rules[name].flags(line) {
				out = append(out, strconv.Itoa(i+1)+":"+name)
			}
		}
	}
	return out
}

func (l *Linter) enabled() []string {
	names := []string{}
	for name := range l.rules {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// The extension round: one more rule, added beside the others.
func (l *Linter) banWord(word string) {
	if word == "" {
		panic("empty word")
	}
	if l.banned == nil {
		l.banned = &bannedWords{map[string]bool{}}
		l.rules["ban-word"] = l.banned
	}
	l.banned.words[word] = true
}
