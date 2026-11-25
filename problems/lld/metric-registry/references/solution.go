package main

import "sort"

const (
	maxStep    = 1_000_000_000
	maxReading = 1_000_000_000_000
)

type MetricRegistry struct {
	counters map[string]int64
	gauges   map[string]int64
}

func NewMetricRegistry() *MetricRegistry {
	return &MetricRegistry{counters: map[string]int64{}, gauges: map[string]int64{}}
}

// A name belongs to one kind for good: the other kind's map must not hold it.
func claimMetric(name string, other map[string]int64) {
	if _, taken := other[name]; name == "" || taken {
		panic("a metric needs a non-empty name of its own kind")
	}
}

func (r *MetricRegistry) inc(name string, by int64) int64 {
	if by < 1 || by > maxStep {
		panic("a counter goes up by 1 to 10^9")
	}
	claimMetric(name, r.gauges)
	r.counters[name] += by
	return r.counters[name]
}

func (r *MetricRegistry) gauge(name string, value int64) {
	if value < -maxReading || value > maxReading {
		panic("a gauge reads within -10^12 and 10^12")
	}
	claimMetric(name, r.counters)
	r.gauges[name] = value
}

func (r *MetricRegistry) read(name string) *int64 {
	if value, ok := r.counters[name]; ok {
		return &value
	}
	if value, ok := r.gauges[name]; ok {
		return &value
	}
	return nil
}

func (r *MetricRegistry) names() []string {
	out := []string{}
	for name := range r.counters {
		out = append(out, name)
	}
	for name := range r.gauges {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// The extension round.
func (r *MetricRegistry) snapshotAndReset() map[string]int64 {
	snapshot := map[string]int64{}
	for name, value := range r.counters {
		snapshot[name] = value
		r.counters[name] = 0
	}
	return snapshot
}
