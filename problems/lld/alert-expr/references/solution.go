package main

import (
	"sort"
	"strconv"
	"strings"
)

const alertMaxDigits = 15

func alertDigit(c byte) bool  { return c >= '0' && c <= '9' }
func alertLetter(c byte) bool { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }
func alertNameChar(c byte) bool {
	return alertLetter(c) || alertDigit(c) || c == '_' || c == '.'
}
func alertKeyword(s string) bool { return s == "and" || s == "or" || s == "not" }
func alertOp(s string) bool {
	switch s {
	case ">", ">=", "<", "<=", "==", "!=":
		return true
	}
	return false
}
func alertName(s string) bool {
	if s == "" || !alertLetter(s[0]) || alertKeyword(s) {
		return false
	}
	for i := 0; i < len(s); i++ {
		if !alertNameChar(s[i]) {
			return false
		}
	}
	return true
}

type alertTally struct{ comparisons int64 }

// An expression in the language: a comparison, or not, and, or over expressions.
type alertNode interface {
	evaluate(metrics map[string]int64, seen *alertTally) bool
	depth() int64
	names(out map[string]bool)
	rename(from, to string)
	text() string
}

type alertCompare struct {
	metric, op string
	value      int64
}

func (c *alertCompare) evaluate(metrics map[string]int64, seen *alertTally) bool {
	seen.comparisons++
	v, ok := metrics[c.metric]
	if !ok {
		return false
	}
	switch c.op {
	case ">":
		return v > c.value
	case ">=":
		return v >= c.value
	case "<":
		return v < c.value
	case "<=":
		return v <= c.value
	case "==":
		return v == c.value
	}
	return v != c.value
}
func (c *alertCompare) depth() int64              { return 1 }
func (c *alertCompare) names(out map[string]bool) { out[c.metric] = true }
func (c *alertCompare) rename(from, to string) {
	if c.metric == from {
		c.metric = to
	}
}
func (c *alertCompare) text() string {
	return c.metric + " " + c.op + " " + strconv.FormatInt(c.value, 10)
}

type alertNot struct{ inner alertNode }

func (n *alertNot) evaluate(metrics map[string]int64, seen *alertTally) bool {
	return !n.inner.evaluate(metrics, seen)
}
func (n *alertNot) depth() int64              { return 1 + n.inner.depth() }
func (n *alertNot) names(out map[string]bool) { n.inner.names(out) }
func (n *alertNot) rename(from, to string)    { n.inner.rename(from, to) }
func (n *alertNot) text() string              { return "not " + n.inner.text() }

type alertBinary struct {
	word        string
	left, right alertNode
}

func (b *alertBinary) evaluate(metrics map[string]int64, seen *alertTally) bool {
	if b.word == "and" {
		return b.left.evaluate(metrics, seen) && b.right.evaluate(metrics, seen)
	}
	return b.left.evaluate(metrics, seen) || b.right.evaluate(metrics, seen)
}
func (b *alertBinary) depth() int64 {
	return 1 + max(b.left.depth(), b.right.depth())
}
func (b *alertBinary) names(out map[string]bool) {
	b.left.names(out)
	b.right.names(out)
}
func (b *alertBinary) rename(from, to string) {
	b.left.rename(from, to)
	b.right.rename(from, to)
}
func (b *alertBinary) text() string {
	return "(" + b.left.text() + " " + b.word + " " + b.right.text() + ")"
}

type alertToken struct{ kind, text string }

func alertTokenize(s string) []alertToken {
	tokens := []alertToken{}
	for i := 0; i < len(s); {
		c := s[i]
		j := i + 1
		two := s[i:min(i+2, len(s))]
		switch {
		case c == ' ':
		case alertDigit(c) || (c == '-' && j < len(s) && alertDigit(s[j])):
			for j < len(s) && alertDigit(s[j]) {
				j++
			}
			tokens = append(tokens, alertToken{"number", s[i:j]})
		case alertLetter(c):
			for j < len(s) && alertNameChar(s[j]) {
				j++
			}
			tokens = append(tokens, alertToken{"word", s[i:j]})
		case len(two) == 2 && alertOp(two):
			j = i + 2
			tokens = append(tokens, alertToken{"symbol", two})
		case strings.IndexByte("<>()", c) >= 0:
			tokens = append(tokens, alertToken{"symbol", string(c)})
		default:
			panic("unexpected character")
		}
		i = j
	}
	return tokens
}

// Recursive descent: each method parses one level of the grammar.
type alertParser struct {
	tokens []alertToken
	pos    int
}

func (p *alertParser) parse() alertNode {
	tree := p.disjunction()
	if p.pos != len(p.tokens) {
		panic("unexpected token")
	}
	return tree
}

func (p *alertParser) disjunction() alertNode {
	tree := p.conjunction()
	for p.take("or") {
		tree = &alertBinary{"or", tree, p.conjunction()}
	}
	return tree
}

func (p *alertParser) conjunction() alertNode {
	tree := p.negation()
	for p.take("and") {
		tree = &alertBinary{"and", tree, p.negation()}
	}
	return tree
}

func (p *alertParser) negation() alertNode {
	if p.take("not") {
		return &alertNot{p.negation()}
	}
	if p.take("(") {
		tree := p.disjunction()
		p.expect("symbol", ")")
		return tree
	}
	metric := p.expect("word", "")
	if alertKeyword(metric) {
		panic("a keyword is not a metric")
	}
	op := p.expect("symbol", "")
	if !alertOp(op) {
		panic("not a comparison")
	}
	number := p.expect("number", "")
	if len(strings.TrimPrefix(number, "-")) > alertMaxDigits {
		panic("number too long")
	}
	value, err := strconv.ParseInt(number, 10, 64)
	if err != nil {
		panic(err)
	}
	return &alertCompare{metric, op, value}
}

func (p *alertParser) take(text string) bool {
	found := p.pos < len(p.tokens) && p.tokens[p.pos].text == text
	if found {
		p.pos++
	}
	return found
}

func (p *alertParser) expect(kind, text string) string {
	if p.pos == len(p.tokens) {
		panic("unexpected end")
	}
	got := p.tokens[p.pos]
	if got.kind != kind || (text != "" && got.text != text) {
		panic("unexpected token")
	}
	p.pos++
	return got.text
}

type AlertExpr struct {
	tree alertNode
	seen alertTally
}

func NewAlertExpr(expression string) *AlertExpr {
	p := &alertParser{tokens: alertTokenize(expression)}
	return &AlertExpr{tree: p.parse()}
}

func (a *AlertExpr) evaluate(metrics map[string]int64) bool {
	return a.tree.evaluate(metrics, &a.seen)
}

func (a *AlertExpr) variables() []string {
	set := map[string]bool{}
	a.tree.names(set)
	out := []string{}
	for name := range set {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func (a *AlertExpr) depth() int64       { return a.tree.depth() }
func (a *AlertExpr) evaluations() int64 { return a.seen.comparisons }

// The extension round: renaming a metric in the parsed tree.
func (a *AlertExpr) rewrite(name string, replacement string) string {
	set := map[string]bool{}
	a.tree.names(set)
	if !set[name] || !alertName(replacement) {
		panic("unknown metric or bad name")
	}
	a.tree.rename(name, replacement)
	return a.tree.text()
}
