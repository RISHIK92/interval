package main

import (
	"regexp"
	"strconv"
)

// Lowest precedence first: a later source overrides an earlier one.
var configSources = []string{"defaults", "file", "env", "flags"}

var configInteger = regexp.MustCompile(`^-?[0-9]{1,15}$`)

// Parsing is its own concern: lookup finds the text, this decides what it means.
func parseInteger(text string) int64 {
	if !configInteger.MatchString(text) {
		panic("not an integer")
	}
	n, _ := strconv.ParseInt(text, 10, 64)
	return n
}

// Each source's entries are kept as given; only resolution knows the precedence.
type LayeredConfig struct {
	layers  map[string]map[string]string
	renamed map[string]string // old key -> new key
}

func NewLayeredConfig() *LayeredConfig {
	c := &LayeredConfig{layers: map[string]map[string]string{}, renamed: map[string]string{}}
	for _, s := range configSources {
		c.layers[s] = map[string]string{}
	}
	return c
}

func (c *LayeredConfig) layer(source string, entries map[string]string) {
	if _, ok := c.layers[source]; !ok {
		panic("unknown source")
	}
	copied := map[string]string{}
	for k, v := range entries {
		if k == "" {
			panic("a key is not empty")
		}
		copied[k] = v
	}
	c.layers[source] = copied
}

// The names a setting may be written under, the current one first.
func (c *LayeredConfig) names(key string) []string {
	if key == "" {
		panic("a key is not empty")
	}
	current, ok := c.renamed[key]
	if !ok {
		current = key
	}
	out := []string{current}
	for o, n := range c.renamed {
		if n == current {
			out = append(out, o)
		}
	}
	return out
}

// The winning source and its value; found is false when no source has the key.
func (c *LayeredConfig) winner(key string) (source string, value string, found bool) {
	names := c.names(key)
	for i := len(configSources) - 1; i >= 0; i-- {
		entries := c.layers[configSources[i]]
		for _, name := range names {
			if v, ok := entries[name]; ok {
				return configSources[i], v, true
			}
		}
	}
	return "", "", false
}

func (c *LayeredConfig) lookup(key string) *string {
	_, value, found := c.winner(key)
	if !found {
		return nil
	}
	return &value
}

func (c *LayeredConfig) origin(key string) *string {
	source, _, found := c.winner(key)
	if !found {
		return nil
	}
	return &source
}

func (c *LayeredConfig) intValue(key string) *int64 {
	_, value, found := c.winner(key)
	if !found {
		return nil
	}
	n := parseInteger(value)
	return &n
}

// The extension round: a renamed setting answers to both names.
func (c *LayeredConfig) alias(oldKey string, newKey string) {
	if oldKey == "" || newKey == "" || oldKey == newKey {
		panic("two different, non-empty keys")
	}
	for o, n := range c.renamed {
		if o == oldKey || n == oldKey || o == newKey || n == newKey {
			panic("a key is in at most one alias")
		}
	}
	c.renamed[oldKey] = newKey
}
