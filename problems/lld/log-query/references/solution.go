package main

import (
	"slices"
	"sort"
	"strconv"
	"strings"
)

type row = map[string]string

const (
	source    = "logs"
	maxTop    = 10_000
	maxDigits = 9
)

var ops = map[string]func(c int) bool{
	"=":  func(c int) bool { return c == 0 },
	"!=": func(c int) bool { return c != 0 },
	"<":  func(c int) bool { return c < 0 },
	"<=": func(c int) bool { return c <= 0 },
	">":  func(c int) bool { return c > 0 },
	">=": func(c int) bool { return c >= 0 },
}

func allDigits(text string) bool {
	if text == "" {
		return false
	}
	for _, c := range text {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func checkName(text string) string {
	if text == "" {
		panic("an empty name")
	}
	for _, c := range text {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '.') {
			panic("a name is letters, digits, _ and .")
		}
	}
	return text
}

func integer(text string) (int, bool) {
	digits := strings.TrimPrefix(text, "-")
	if len(digits) <= maxDigits && allDigits(digits) {
		n, _ := strconv.Atoi(text)
		return n, true
	}
	return 0, false
}

// One order for every stage: integers by value, before every other value, and other
// values by character code.
func compare(a, b string) int {
	x, xok := integer(a)
	y, yok := integer(b)
	switch {
	case xok && yok:
		return sign(x - y)
	case xok:
		return -1
	case yok:
		return 1
	}
	return strings.Compare(a, b)
}

func sign(n int) int {
	switch {
	case n > 0:
		return 1
	case n < 0:
		return -1
	}
	return 0
}

type visitor interface {
	where(s *whereStage) string
	count(s *countStage) string
	sort(s *sortStage) string
	top(s *topStage) string
}

type stage interface {
	apply(rows []row) []row
	accept(v visitor) string
}

type whereStage struct{ field, op, value string }

func (s *whereStage) apply(rows []row) []row {
	out := []row{}
	for _, r := range rows {
		if v, ok := r[s.field]; ok && ops[s.op](compare(v, s.value)) {
			out = append(out, r)
		}
	}
	return out
}

func (s *whereStage) accept(v visitor) string { return v.where(s) }

type countStage struct{ field string }

func (s *countStage) apply(rows []row) []row {
	order := []string{} // in order of first appearance
	counts := map[string]int{}
	for _, r := range rows {
		if v, ok := r[s.field]; ok {
			if counts[v] == 0 {
				order = append(order, v)
			}
			counts[v]++
		}
	}
	out := []row{}
	for _, v := range order {
		out = append(out, row{s.field: v, "count": strconv.Itoa(counts[v])})
	}
	return out
}

func (s *countStage) accept(v visitor) string { return v.count(s) }

type sortStage struct {
	field      string
	descending bool
}

func (s *sortStage) apply(rows []row) []row {
	having, without := []row{}, []row{}
	for _, r := range rows {
		if _, ok := r[s.field]; ok {
			having = append(having, r)
		} else {
			without = append(without, r)
		}
	}
	order := 1
	if s.descending {
		order = -1
	}
	// A stable sort: equal rows keep their order.
	sort.SliceStable(having, func(i, j int) bool {
		return order*compare(having[i][s.field], having[j][s.field]) < 0
	})
	return append(having, without...)
}

func (s *sortStage) accept(v visitor) string { return v.sort(s) }

type topStage struct{ n int }

func (s *topStage) apply(rows []row) []row { return rows[:min(s.n, len(rows))] }

func (s *topStage) accept(v visitor) string { return v.top(s) }

// A visitor: one line per stage, in a canonical spelling.
type explainer struct{}

func (explainer) where(s *whereStage) string { return "where " + s.field + " " + s.op + " " + s.value }
func (explainer) count(s *countStage) string { return "count " + s.field }
func (explainer) sort(s *sortStage) string {
	if s.descending {
		return "sort " + s.field + " desc"
	}
	return "sort " + s.field + " asc"
}
func (explainer) top(s *topStage) string { return "top " + strconv.Itoa(s.n) }

// The parsed query: a source and its stages.
type pipeline struct {
	source string
	stages []stage
}

func parseStage(w []string) stage {
	kind, n := w[0], len(w)
	if _, isOp := ops[safe(w, 2)]; kind == "where" && n == 4 && isOp {
		return &whereStage{checkName(w[1]), w[2], w[3]}
	}
	if kind == "count" && n == 2 && w[1] != "count" {
		return &countStage{checkName(w[1])}
	}
	if kind == "sort" && n == 2 {
		return &sortStage{checkName(w[1]), false}
	}
	if kind == "sort" && n == 3 && (w[2] == "asc" || w[2] == "desc") {
		return &sortStage{checkName(w[1]), w[2] == "desc"}
	}
	if kind == "top" && n == 2 && len(w[1]) <= 5 && allDigits(w[1]) {
		if top, _ := strconv.Atoi(w[1]); top >= 1 && top <= maxTop {
			return &topStage{top}
		}
	}
	panic("not a stage")
}

func safe(w []string, i int) string {
	if i < len(w) {
		return w[i]
	}
	return ""
}

func parse(query string) pipeline {
	parts := [][]string{}
	for _, part := range strings.Split(query, "|") {
		words := slices.DeleteFunc(strings.Split(part, " "), func(w string) bool { return w == "" })
		if len(words) == 0 {
			panic("an empty part")
		}
		parts = append(parts, words)
	}
	if len(parts[0]) != 1 {
		panic("a bad source")
	}
	p := pipeline{source: parts[0][0]}
	for _, words := range parts[1:] {
		p.stages = append(p.stages, parseStage(words))
	}
	return p
}

type LogQuery struct {
	records []row
	views   map[string]pipeline
}

func NewLogQuery() *LogQuery {
	return &LogQuery{records: []row{}, views: map[string]pipeline{}}
}

func (q *LogQuery) ingest(fields map[string]string) {
	if len(fields) == 0 {
		panic("an empty record")
	}
	for name, value := range fields {
		checkName(name)
		if value == "" {
			panic("an empty value")
		}
	}
	r := row{}
	for name, value := range fields {
		r[name] = value
	}
	q.records = append(q.records, r)
}

func (q *LogQuery) run(query string) []string {
	out := []string{}
	for _, r := range q.rows(q.checked(query)) {
		keys := make([]string, 0, len(r))
		for k := range r {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, len(keys))
		for i, k := range keys {
			parts[i] = k + "=" + r[k]
		}
		out = append(out, strings.Join(parts, " "))
	}
	return out
}

func (q *LogQuery) explainQuery(query string) []string {
	return q.explain(q.checked(query))
}

// The extension round: saved views, usable as sources.
func (q *LogQuery) saveView(name string, query string) {
	checkName(name)
	p := q.checked(query)
	if _, taken := q.views[name]; taken || name == source {
		panic("that source exists")
	}
	q.views[name] = p
}

func (q *LogQuery) checked(query string) pipeline {
	p := parse(query)
	if _, isView := q.views[p.source]; p.source != source && !isView {
		panic("no such source")
	}
	return p
}

func (q *LogQuery) rows(p pipeline) []row {
	rows := q.records
	if view, ok := q.views[p.source]; ok {
		rows = q.rows(view)
	}
	for _, s := range p.stages {
		rows = s.apply(rows)
	}
	return rows
}

func (q *LogQuery) explain(p pipeline) []string {
	lines := []string{"source " + source}
	if view, ok := q.views[p.source]; ok {
		lines = q.explain(view)
	}
	for _, s := range p.stages {
		lines = append(lines, s.accept(explainer{}))
	}
	return lines
}
