package main

import (
	"sort"
	"strings"
)

// The legacy agent's units, each as how many of the new API's base units it is.
var maTimeUnits = map[string]float64{"s": 1000, "ms": 1, "us": 0.001}
var maSizeUnits = map[string]int64{"B": 1, "KB": 1024, "MB": 1024 * 1024}

// The new metrics API: it knows only milliseconds and bytes, and each name is one or the
// other.
type maMetricsApi struct {
	ms    map[string]float64
	bytes map[string]int64
}

func (a *maMetricsApi) recordMs(name string, value float64) bool {
	if _, ok := a.bytes[name]; ok {
		return false
	}
	a.ms[name] = value
	return true
}

func (a *maMetricsApi) recordBytes(name string, size int64) bool {
	if _, ok := a.ms[name]; ok {
		return false
	}
	a.bytes[name] = size
	return true
}

func (a *maMetricsApi) names() []string {
	all := []string{}
	for name := range a.ms {
		all = append(all, name)
	}
	for name := range a.bytes {
		all = append(all, name)
	}
	sort.Strings(all)
	return all
}

// Speaks the legacy agent's `name value unit` lines and feeds the new API: the only code
// that knows the old format and units.
type MetricsAdapter struct {
	api *maMetricsApi
}

func NewMetricsAdapter() *MetricsAdapter {
	return &MetricsAdapter{api: &maMetricsApi{ms: map[string]float64{}, bytes: map[string]int64{}}}
}

func (m *MetricsAdapter) ingestLegacy(line string) bool {
	if line == "" {
		panic("empty line")
	}
	return m.ingest(line)
}

func (m *MetricsAdapter) gaugeMs(name string) *float64 {
	maNamed(name)
	if value, ok := m.api.ms[name]; ok {
		return &value
	}
	return nil
}

func (m *MetricsAdapter) gaugeBytes(name string) *int64 {
	maNamed(name)
	if size, ok := m.api.bytes[name]; ok {
		return &size
	}
	return nil
}

func (m *MetricsAdapter) names() []string {
	return m.api.names()
}

// The extension round: a batch of lines, each as ingestLegacy takes it.
func (m *MetricsAdapter) ingestBatch(lines []string) int64 {
	var good int64
	for _, line := range lines {
		if m.ingest(line) {
			good++
		}
	}
	return good
}

func (m *MetricsAdapter) ingest(line string) bool {
	fields := strings.Split(line, " ")
	if len(fields) != 3 || fields[0] == "" {
		return false
	}
	value, ok := maNumber(fields[1])
	if !ok {
		return false
	}
	if ms, ok := maTimeUnits[fields[2]]; ok {
		return m.api.recordMs(fields[0], float64(value)*ms)
	}
	if bytes, ok := maSizeUnits[fields[2]]; ok {
		return m.api.recordBytes(fields[0], value*bytes)
	}
	return false
}

func maNumber(text string) (int64, bool) {
	if len(text) == 0 || len(text) > 9 {
		return 0, false
	}
	var value int64
	for _, c := range text {
		if c < '0' || c > '9' {
			return 0, false
		}
		value = value*10 + int64(c-'0')
	}
	return value, true
}

func maNamed(name string) {
	if name == "" {
		panic("empty name")
	}
}
