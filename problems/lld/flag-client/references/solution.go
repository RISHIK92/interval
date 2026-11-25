package main

import "strings"

func filled(text string) string {
	if text == "" {
		panic("empty")
	}
	return text
}

// The user's bucket for this flag, 0 to 99: a hash, so it's stable across calls and
// clients, and different flags split users differently.
func bucket(flag, user string) int64 {
	var h int64
	for _, c := range flag + ":" + user {
		h = (h*31 + int64(c)) % 1000003
	}
	return h % 100
}

// The adapter side: each rule string from the server becomes a small rule object.
type rule interface {
	matches(flag, user string, attrs map[string]string) bool
}

type userRule struct{ name string }

func (r userRule) matches(_, user string, _ map[string]string) bool { return user == r.name }

type attrRule struct{ key, value string }

func (r attrRule) matches(_, _ string, attrs map[string]string) bool {
	value, ok := attrs[r.key]
	return ok && value == r.value
}

type percentRule struct{ percent int64 }

func (r percentRule) matches(flag, user string, _ map[string]string) bool {
	return bucket(flag, user) < r.percent
}

func newPercentRule(text string) rule {
	if text == "" || len(text) > 3 || (text[0] == '0' && text != "0") {
		panic("0 to 100")
	}
	var n int64
	for _, c := range text {
		if c < '0' || c > '9' {
			panic("0 to 100")
		}
		n = n*10 + int64(c-'0')
	}
	if n > 100 {
		panic("0 to 100")
	}
	return percentRule{n}
}

func newAttrRule(text string) rule {
	key, value, ok := strings.Cut(text, "=")
	if !ok {
		panic("attr:<key>=<value>")
	}
	return attrRule{filled(key), filled(value)}
}

var rules = map[string]func(rest string) rule{
	"user":    func(rest string) rule { return userRule{filled(rest)} },
	"attr":    newAttrRule,
	"percent": newPercentRule,
}

func parseRule(text string) rule {
	// A rule without a ":" leaves nothing for the rule itself, and every rule needs it.
	kind, rest, _ := strings.Cut(text, ":")
	build, ok := rules[kind]
	if !ok {
		panic("an unknown rule")
	}
	return build(rest)
}

type published struct {
	rules   []rule
	version int64
}

// The facade: evaluate hides fetching, the local copy of the rules (a proxy for the flag
// server) and the rule types. Until a sync reaches the server it answers with the
// defaults; while the server is down it keeps answering from its last copy.
type FlagClient struct {
	defaults  map[string]bool
	server    map[string]published
	copy      map[string][]rule
	synced    bool
	syncedAt  int64
	overrides map[string]bool
}

func NewFlagClient(defaults map[string]bool) *FlagClient {
	own := map[string]bool{}
	for flag, on := range defaults {
		own[filled(flag)] = on
	}
	return &FlagClient{defaults: own, server: map[string]published{}, copy: map[string][]rule{},
		overrides: map[string]bool{}}
}

func (c *FlagClient) serverRules(flag string, texts []string, version int64) {
	filled(flag)
	if version < 1 {
		panic("versions start at 1")
	}
	parsed := make([]rule, 0, len(texts))
	for _, text := range texts {
		parsed = append(parsed, parseRule(text))
	}
	if current, ok := c.server[flag]; !ok || version > current.version {
		c.server[flag] = published{parsed, version}
	}
}

func (c *FlagClient) sync(nowMs int64, reachable bool) bool {
	if !reachable {
		return false
	}
	c.copy = map[string][]rule{}
	for flag, p := range c.server {
		c.copy[flag] = p.rules
	}
	c.synced, c.syncedAt = true, nowMs
	return true
}

func (c *FlagClient) evaluate(flag string, user string, attrs map[string]string) bool {
	filled(flag)
	filled(user)
	if on, ok := c.overrides[flag]; ok {
		return on
	}
	if rs, ok := c.copy[flag]; ok {
		for _, r := range rs {
			if r.matches(flag, user, attrs) {
				return true
			}
		}
		return false
	}
	on, ok := c.defaults[flag]
	if !ok {
		panic("no rules and no default")
	}
	return on
}

func (c *FlagClient) staleMs(nowMs int64) int64 {
	if !c.synced {
		panic("never synced")
	}
	return nowMs - c.syncedAt
}

// The extension round: a local override wins over everything else.
func (c *FlagClient) localOverride(flag string, on bool) {
	c.overrides[filled(flag)] = on
}
