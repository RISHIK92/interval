package main

import (
	"fmt"
	"regexp"
	"sort"
)

var envKeyPattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)

func checkedEnvKey(key string) string {
	if !envKeyPattern.MatchString(key) {
		panic("an env key is upper snake case")
	}
	return key
}

type envValue struct {
	value  string
	secret bool
}

type JobSpec struct {
	name  string
	steps []string
	env   map[string]envValue
}

func NewJobSpec(name string) *JobSpec {
	if name == "" {
		panic("a job needs a name")
	}
	return &JobSpec{name: name, env: map[string]envValue{}}
}

func (j *JobSpec) addStep(command string) int64 {
	if command == "" {
		panic("a step needs a command")
	}
	j.steps = append(j.steps, command)
	return int64(len(j.steps))
}

func (j *JobSpec) setEnv(key string, value string) {
	j.env[checkedEnvKey(key)] = envValue{value: value}
}

func (j *JobSpec) render() []string {
	lines := []string{"job " + j.name}
	keys := make([]string, 0, len(j.env))
	for key := range j.env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		v := j.env[key]
		shown := v.value
		if v.secret {
			shown = "***"
		}
		lines = append(lines, "env "+key+"="+shown)
	}
	for i, command := range j.steps {
		lines = append(lines, fmt.Sprintf("step %d: %s", i+1, command))
	}
	return lines
}

func (j *JobSpec) stepCount() int64 {
	return int64(len(j.steps))
}

// The extension round.
func (j *JobSpec) secret(key string, value string) {
	j.env[checkedEnvKey(key)] = envValue{value: value, secret: true}
}
