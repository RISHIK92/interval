package main

import (
	"slices"
	"strconv"
	"strings"
)

const (
	anyWord   = "*"
	userWord  = "{user}"
	noMatch   = "no-match"
	simulated = "(new)"
	hoursADay = 24
)

func checkNamed(names ...string) {
	if slices.Contains(names, "") {
		panic("an empty name")
	}
}

func hourPart(text string) int64 {
	if len(text) > 2 || text == "" || strings.Trim(text, "0123456789") != "" {
		panic("an hour is one or two digits")
	}
	n, _ := strconv.ParseInt(text, 10, 64)
	return n
}

// A resource pattern: literal characters, `*` for any run of characters, and `{user}`
// for the requesting user's name, matched literally.
type glob struct {
	parts []string // each one literal character, anyWord or userWord
}

func newGlob(text string) glob {
	g := glob{}
	for k, chunk := range strings.Split(text, userWord) {
		if k > 0 {
			g.parts = append(g.parts, userWord)
		}
		for _, c := range chunk {
			if c == '{' || c == '}' {
				panic("a brace outside {user}")
			}
			g.parts = append(g.parts, string(c))
		}
	}
	return g
}

func (g glob) matches(resource, user string) bool {
	// "" for anyWord, otherwise one literal character.
	items := []string{}
	for _, part := range g.parts {
		switch part {
		case userWord:
			for _, c := range user {
				items = append(items, string(c))
			}
		case anyWord:
			items = append(items, "")
		default:
			items = append(items, part)
		}
	}
	// reach[j]: the items so far can match the first j characters.
	reach := make([]bool, len(resource)+1)
	reach[0] = true
	for _, item := range items {
		next := make([]bool, len(resource)+1)
		for j := 0; j <= len(resource); j++ {
			if item == "" {
				next[j] = reach[j] || (j > 0 && next[j-1])
			} else {
				next[j] = j > 0 && reach[j-1] && resource[j-1:j] == item
			}
		}
		reach = next
	}
	return reach[len(resource)]
}

// One parsed rule. A request it matches is decided by its effect.
type policy struct {
	id, effect, role, action string
	resource                 glob
	hours                    []int64 // from, to (not included); nil for every hour
}

func newPolicy(id, text string) policy {
	words := slices.DeleteFunc(strings.Split(text, " "), func(w string) bool { return w == "" })
	if (len(words) != 4 && len(words) != 6) || (words[0] != "allow" && words[0] != "deny") {
		panic("effect role action resource [during from-to]")
	}
	p := policy{id: id, effect: words[0], role: words[1], action: words[2], resource: newGlob(words[3])}
	if len(words) == 6 {
		hours := strings.Split(words[5], "-")
		if words[4] != "during" || len(hours) != 2 {
			panic("during from-to")
		}
		start, end := hourPart(hours[0]), hourPart(hours[1])
		if start >= end || end > hoursADay {
			panic("hours run forward, up to 24")
		}
		p.hours = []int64{start, end}
	}
	return p
}

func (p policy) matches(user string, roles []string, action, resource string, hour int64) bool {
	return (p.role == anyWord || slices.Contains(roles, p.role)) &&
		(p.action == anyWord || p.action == action) &&
		(p.hours == nil || (p.hours[0] <= hour && hour < p.hours[1])) &&
		p.resource.matches(resource, user)
}

func decideWith(policies []policy, user string, roles []string, action, resource string, hour int64) string {
	checkNamed(append([]string{user, action, resource}, roles...)...)
	if hour < 0 || hour >= hoursADay {
		panic("an hour runs from 0 to 23")
	}
	// A chain of responsibility in two passes: any deny that matches decides first, then
	// the earliest allow; with neither, the request falls off the chain.
	for _, effect := range []string{"deny", "allow"} {
		for _, p := range policies {
			if p.effect == effect && p.matches(user, roles, action, resource, hour) {
				return effect + ":" + p.id
			}
		}
	}
	return noMatch
}

type PolicyEngine struct {
	policies []policy
}

func NewPolicyEngine() *PolicyEngine { return &PolicyEngine{} }

func (e *PolicyEngine) addPolicy(id string, text string) bool {
	checkNamed(id)
	p := newPolicy(id, text)
	for _, existing := range e.policies {
		if existing.id == id {
			return false
		}
	}
	e.policies = append(e.policies, p)
	return true
}

func (e *PolicyEngine) removePolicy(id string) bool {
	checkNamed(id)
	before := len(e.policies)
	e.policies = slices.DeleteFunc(e.policies, func(p policy) bool { return p.id == id })
	return len(e.policies) < before
}

func (e *PolicyEngine) decide(user string, roles []string, action string, resource string, hour int64) string {
	return decideWith(e.policies, user, roles, action, resource, hour)
}

// The extension round: a decision as if one more policy existed.
func (e *PolicyEngine) simulate(text string, user string, roles []string, action string, resource string, hour int64) string {
	all := append(slices.Clone(e.policies), newPolicy(simulated, text))
	return decideWith(all, user, roles, action, resource, hour)
}
