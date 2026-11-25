package main

import "sort"

// Callers tell the gate what happened and ask it one question, "may I deploy?". Which
// checks are required, what they last reported and which are waived stay inside.
type DeployGate struct {
	required map[string]bool
	passed   map[string]bool   // each check's latest report
	waived   map[string]string // check -> reason
}

func NewDeployGate() *DeployGate {
	return &DeployGate{required: map[string]bool{}, passed: map[string]bool{}, waived: map[string]string{}}
}

func checkNamed(name string) {
	if name == "" {
		panic("check names are not empty")
	}
}

func (g *DeployGate) require(check string) {
	checkNamed(check)
	g.required[check] = true
}

func (g *DeployGate) report(check string, passed bool) {
	checkNamed(check)
	g.passed[check] = passed
}

func (g *DeployGate) blocks(check string) bool {
	_, waived := g.waived[check]
	return !waived && !g.passed[check]
}

func (g *DeployGate) mayDeploy() bool {
	return len(g.blockers()) == 0
}

func (g *DeployGate) blockers() []string {
	out := []string{}
	for c := range g.required {
		if g.blocks(c) {
			out = append(out, c)
		}
	}
	sort.Strings(out)
	return out
}

// The extension round: a waived check never blocks.
func (g *DeployGate) waive(check string, reason string) {
	checkNamed(check)
	if reason == "" {
		panic("a waiver has a reason")
	}
	if !g.required[check] {
		panic("only a required check is waived")
	}
	g.waived[check] = reason
}

func (g *DeployGate) waivers() []string {
	checks := []string{}
	for c := range g.waived {
		checks = append(checks, c)
	}
	sort.Strings(checks)
	out := []string{}
	for _, c := range checks {
		out = append(out, c+": "+g.waived[c])
	}
	return out
}
