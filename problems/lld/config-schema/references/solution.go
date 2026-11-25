package main

import (
	"sort"
	"strconv"
	"strings"
)

// One check on one field's value; nil when the field is absent.
type configRule interface {
	violation(value *string) string
}

func isConfigInt(text string) bool {
	digits := strings.TrimPrefix(text, "-")
	if len(digits) < 1 || len(digits) > 15 {
		return false
	}
	for _, c := range digits {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

type requiredRule struct{}

func (requiredRule) violation(value *string) string {
	if value == nil {
		return "missing"
	}
	return ""
}

type intRangeRule struct{ low, high int64 }

func (r intRangeRule) violation(value *string) string {
	if value == nil {
		return ""
	}
	if !isConfigInt(*value) {
		return "not an integer"
	}
	n, _ := strconv.ParseInt(*value, 10, 64)
	if n < r.low || n > r.high {
		return "out of range"
	}
	return ""
}

type oneOfRule struct{ items []string }

func (r oneOfRule) violation(value *string) string {
	if value == nil {
		return ""
	}
	for _, item := range r.items {
		if item == *value {
			return ""
		}
	}
	return "not allowed"
}

func parseConfigSpec(spec string) configRule {
	if spec == "required" {
		return requiredRule{}
	}
	kind, rest, _ := strings.Cut(spec, ":")
	switch kind {
	case "int":
		bounds := strings.Split(rest, ":")
		if len(bounds) == 2 && isConfigInt(bounds[0]) && isConfigInt(bounds[1]) {
			low, _ := strconv.ParseInt(bounds[0], 10, 64)
			high, _ := strconv.ParseInt(bounds[1], 10, 64)
			if low <= high {
				return intRangeRule{low, high}
			}
		}
	case "oneOf":
		items := strings.Split(rest, ",")
		empty := false
		for _, item := range items {
			empty = empty || item == ""
		}
		if !empty {
			return oneOfRule{items}
		}
	}
	panic("unknown spec")
}

type ConfigSchema struct {
	rules     map[string][]configRule
	fallbacks map[string]string
}

func NewConfigSchema() *ConfigSchema {
	return &ConfigSchema{rules: map[string][]configRule{}, fallbacks: map[string]string{}}
}

func (s *ConfigSchema) rule(field string, spec string) {
	parsed := parseConfigSpec(spec)
	_, required := parsed.(requiredRule)
	_, hasFallback := s.fallbacks[field]
	if field == "" || (required && hasFallback) {
		panic("a field name is never empty, and this field can't take this rule")
	}
	s.rules[field] = append(s.rules[field], parsed)
}

func (s *ConfigSchema) check(env map[string]string) []string {
	out := []string{}
	for _, field := range s.fields() {
		var value *string
		if v, ok := env[field]; ok {
			value = &v
		} else if v, ok := s.fallbacks[field]; ok {
			value = &v
		}
		for _, rule := range s.rules[field] {
			if problem := rule.violation(value); problem != "" {
				out = append(out, field+": "+problem)
			}
		}
	}
	return out
}

func (s *ConfigSchema) fields() []string {
	out := []string{}
	for field := range s.rules {
		out = append(out, field)
	}
	sort.Strings(out)
	return out
}

// The extension round.
func (s *ConfigSchema) fallback(field string, value string) {
	rules := s.rules[field]
	ok := len(rules) > 0
	for _, rule := range rules {
		if _, required := rule.(requiredRule); required {
			ok = false
		}
	}
	if !ok {
		panic("a fallback needs a field with rules and none required")
	}
	s.fallbacks[field] = value
}
