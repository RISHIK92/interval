package main

import (
	"sort"
	"strconv"
)

const manifestLoadBalancer = 20
const manifestMost = 1000000

type manifest interface {
	accept(v manifestVisitor)
}

type deploymentManifest struct {
	name        string
	replicas    int64
	cpu, memory *int64
	privileged  bool
}

func (d *deploymentManifest) accept(v manifestVisitor) { v.deployment(d) }

type serviceManifest struct {
	name     string
	port     int64
	isPublic bool
}

func (s *serviceManifest) accept(v manifestVisitor) { v.service(s) }

type configMapManifest struct {
	name             string
	entries, secrets int64
}

func (c *configMapManifest) accept(v manifestVisitor) { v.configmap(c) }

// One operation over every kind. A new operation is a new visitor; the manifest types
// above never change for it.
type manifestVisitor interface {
	deployment(d *deploymentManifest)
	service(s *serviceManifest)
	configmap(c *configMapManifest)
	finish() []string
}

type collected struct{ lines []string }

func (c *collected) finish() []string { return c.lines }

type inventoryVisitor struct{ collected }

func (v *inventoryVisitor) deployment(d *deploymentManifest) {
	v.lines = append(v.lines, "deployment/"+d.name+" replicas="+strconv.FormatInt(d.replicas, 10))
}
func (v *inventoryVisitor) service(s *serviceManifest) {
	v.lines = append(v.lines, "service/"+s.name+" port="+strconv.FormatInt(s.port, 10))
}
func (v *inventoryVisitor) configmap(c *configMapManifest) {
	v.lines = append(v.lines, "configmap/"+c.name+" entries="+strconv.FormatInt(c.entries, 10))
}

type lintVisitor struct{ collected }

func (v *lintVisitor) deployment(d *deploymentManifest) {
	if d.replicas == 1 {
		v.lines = append(v.lines, "deployment/"+d.name+": single replica")
	}
	if d.cpu == nil {
		v.lines = append(v.lines, "deployment/"+d.name+": no cpu limit")
	}
}
func (v *lintVisitor) service(*serviceManifest) {} // nothing about a service is linted yet
func (v *lintVisitor) configmap(c *configMapManifest) {
	if c.entries == 0 {
		v.lines = append(v.lines, "configmap/"+c.name+": empty")
	}
}

type costVisitor struct {
	collected
	total int64
}

func (v *costVisitor) add(what string, cost int64) {
	v.lines = append(v.lines, what+" "+strconv.FormatInt(cost, 10))
	v.total += cost
}

func orZero(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

func (v *costVisitor) deployment(d *deploymentManifest) {
	v.add("deployment/"+d.name, d.replicas*(orZero(d.cpu)+orZero(d.memory)))
}
func (v *costVisitor) service(s *serviceManifest) {
	var cost int64
	if s.isPublic {
		cost = manifestLoadBalancer
	}
	v.add("service/"+s.name, cost)
}
func (v *costVisitor) configmap(c *configMapManifest) { v.add("configmap/"+c.name, 0) }
func (v *costVisitor) finish() []string {
	return append(append([]string{}, v.lines...), "total "+strconv.FormatInt(v.total, 10))
}

type securityVisitor struct{ collected }

func (v *securityVisitor) deployment(d *deploymentManifest) {
	if d.privileged {
		v.lines = append(v.lines, "deployment/"+d.name+": privileged")
	}
}
func (v *securityVisitor) service(s *serviceManifest) {
	if s.isPublic {
		v.lines = append(v.lines, "service/"+s.name+": public")
	}
}
func (v *securityVisitor) configmap(c *configMapManifest) {
	if c.secrets > 0 {
		v.lines = append(v.lines, "configmap/"+c.name+": plain-text secrets")
	}
}

var manifestVisitors = map[string]func() manifestVisitor{
	"inventory": func() manifestVisitor { return &inventoryVisitor{} },
	"lint":      func() manifestVisitor { return &lintVisitor{} },
	"cost":      func() manifestVisitor { return &costVisitor{} },
}

// Per kind: each field with its least and greatest value, and whether it is required.
type fieldRange struct {
	low, high int64
	required  bool
}

type manifestKind struct {
	make   func(name string, f map[string]int64) manifest
	fields map[string]fieldRange
}

func optionalField(f map[string]int64, key string) *int64 {
	if v, ok := f[key]; ok {
		return &v
	}
	return nil
}

var flagRange = fieldRange{0, 1, false}

var manifestKinds = map[string]manifestKind{
	"deployment": {
		func(n string, f map[string]int64) manifest {
			return &deploymentManifest{n, f["replicas"], optionalField(f, "cpu"), optionalField(f, "memory"), f["privileged"] == 1}
		},
		map[string]fieldRange{
			"replicas": {0, manifestMost, true}, "cpu": {1, manifestMost, false},
			"memory": {1, manifestMost, false}, "privileged": flagRange,
		},
	},
	"service": {
		func(n string, f map[string]int64) manifest { return &serviceManifest{n, f["port"], f["public"] == 1} },
		map[string]fieldRange{"port": {1, 65535, true}, "public": flagRange},
	},
	"configmap": {
		func(n string, f map[string]int64) manifest { return &configMapManifest{n, f["entries"], f["secrets"]} },
		map[string]fieldRange{"entries": {0, manifestMost, true}, "secrets": {0, manifestMost, false}},
	},
}

type ManifestSet struct {
	items []manifest
	names map[string]map[string]bool
}

func NewManifestSet() *ManifestSet {
	return &ManifestSet{names: map[string]map[string]bool{}}
}

func (m *ManifestSet) addResource(kind string, name string, fields map[string]int64) bool {
	spec, ok := manifestKinds[kind]
	if !ok || name == "" {
		panic("unknown kind or empty name")
	}
	for key, value := range fields {
		r, ok := spec.fields[key]
		if !ok {
			panic("unknown field")
		}
		if value < r.low || value > r.high {
			panic("value out of range")
		}
	}
	for key, r := range spec.fields {
		if _, given := fields[key]; r.required && !given {
			panic("missing field")
		}
	}
	if m.names[kind][name] {
		return false
	}
	if m.names[kind] == nil {
		m.names[kind] = map[string]bool{}
	}
	m.names[kind][name] = true
	m.items = append(m.items, spec.make(name, fields))
	return true
}

func (m *ManifestSet) runVisitor(visitor string) []string {
	build, ok := manifestVisitors[visitor]
	if !ok {
		panic("unknown visitor")
	}
	return m.walk(build())
}

func (m *ManifestSet) kinds() []string {
	out := []string{}
	for kind := range m.names {
		out = append(out, kind)
	}
	sort.Strings(out)
	return out
}

// The extension round: a fourth operation, and no manifest type changes.
func (m *ManifestSet) securityAudit() []string {
	return m.walk(&securityVisitor{})
}

func (m *ManifestSet) walk(v manifestVisitor) []string {
	for _, item := range m.items {
		item.accept(v)
	}
	return v.finish()
}
