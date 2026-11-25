package main

import "sort"

// A prototype: anything made from it is a copy that shares no state with it. It remembers
// the variables it started with, so it can tell what changed since.
type environment struct {
	variables map[string]string
	started   map[string]string
}

func copyVars(vars map[string]string) map[string]string {
	out := make(map[string]string, len(vars))
	for k, v := range vars {
		out[k] = v
	}
	return out
}

func newEnvironment(vars map[string]string) *environment {
	return &environment{variables: copyVars(vars), started: copyVars(vars)}
}

func (e *environment) copy() *environment {
	return newEnvironment(e.variables)
}

func filled(text string) {
	if text == "" {
		panic("names, keys and values are not empty")
	}
}

type EnvTemplates struct {
	templates map[string]*environment
	envs      map[string]*environment
}

func NewEnvTemplates() *EnvTemplates {
	return &EnvTemplates{templates: map[string]*environment{}, envs: map[string]*environment{}}
}

func (t *EnvTemplates) env(env string) *environment {
	found, ok := t.envs[env]
	if !ok {
		panic("unknown environment")
	}
	return found
}

func (t *EnvTemplates) define(name string, vars map[string]string) {
	filled(name)
	for key, value := range vars {
		filled(key)
		filled(value)
	}
	t.templates[name] = newEnvironment(vars)
}

func (t *EnvTemplates) fork(base string, env string) bool {
	filled(env)
	template, ok := t.templates[base]
	if !ok {
		panic("unknown template")
	}
	if _, taken := t.envs[env]; taken {
		return false
	}
	t.envs[env] = template.copy()
	return true
}

func (t *EnvTemplates) setVar(env string, key string, value string) bool {
	found := t.env(env)
	filled(key)
	filled(value)
	if current, ok := found.variables[key]; ok && current == value {
		return false
	}
	found.variables[key] = value
	return true
}

func (t *EnvTemplates) vars(env string) map[string]string {
	return copyVars(t.env(env).variables)
}

// The extension round: what an environment changed since it was forked.
func (t *EnvTemplates) diff(env string) []string {
	found := t.env(env)
	keys := make([]string, 0, len(found.variables))
	for k := range found.variables {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := []string{}
	for _, key := range keys {
		value := found.variables[key]
		if was, ok := found.started[key]; !ok {
			out = append(out, "+"+key+"="+value)
		} else if was != value {
			out = append(out, "~"+key+"="+value)
		}
	}
	return out
}
