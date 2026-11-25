package main

import (
	"sort"
	"strconv"
	"strings"
)

var bounds = []int64{10, 100, 1000}

func allowed(text string, extra string) bool {
	if text == "" {
		return false
	}
	for _, c := range text {
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' ||
			strings.ContainsRune(extra, c)
		if !ok {
			return false
		}
	}
	return true
}

func word(text string, extra string) {
	if !allowed(text, extra) {
		panic("a name, tag key or tag value with a character it can't have")
	}
}

type tag struct{ key, value string }

// A sample is one exported number: its name, the tags it adds to its series' tags, and
// its value. A metric kind decides its samples; a format decides how one is written.
type sample struct {
	name  string
	extra []tag
	value int64
}

type metric interface {
	kind() string
	add(value int64)
	samples(name string) []sample
}

type counterMetric struct{ total int64 }

func (c *counterMetric) kind() string { return "counter" }
func (c *counterMetric) add(by int64) { c.total += by }
func (c *counterMetric) samples(name string) []sample {
	return []sample{{name, nil, c.total}}
}

type histogramMetric struct {
	buckets    []int64
	count, sum int64
}

func (h *histogramMetric) kind() string { return "histogram" }
func (h *histogramMetric) add(val int64) {
	for i, bound := range bounds {
		if val <= bound {
			h.buckets[i]++
		}
	}
	h.count++
	h.sum += val
}
func (h *histogramMetric) samples(name string) []sample {
	out := []sample{}
	for i, bound := range bounds {
		out = append(out, sample{name + "_bucket", []tag{{"le", strconv.FormatInt(bound, 10)}}, h.buckets[i]})
	}
	out = append(out, sample{name + "_bucket", []tag{{"le", "+Inf"}}, h.count})
	out = append(out, sample{name + "_sum", nil, h.sum})
	return append(out, sample{name + "_count", nil, h.count})
}

type gaugeMetric struct{ level int64 }

func (g *gaugeMetric) kind() string  { return "gauge" }
func (g *gaugeMetric) add(val int64) { g.level = val }
func (g *gaugeMetric) samples(name string) []sample {
	return []sample{{name, nil, g.level}}
}

// The bridge's other side: how a sample is written, whatever kind it came from.
type format interface {
	header(name, kind string) []string
	line(s sample, tags []tag, kind string) string
}

type prometheusFormat struct{}

func (prometheusFormat) header(name, kind string) []string {
	return []string{"# TYPE " + name + " " + kind}
}

func (prometheusFormat) line(s sample, tags []tag, _ string) string {
	value := strconv.FormatInt(s.value, 10)
	if len(tags) == 0 {
		return s.name + " " + value
	}
	parts := make([]string, len(tags))
	for i, t := range tags {
		parts[i] = t.key + "=\"" + t.value + "\""
	}
	return s.name + "{" + strings.Join(parts, ",") + "} " + value
}

type statsdFormat struct{}

func (statsdFormat) header(string, string) []string { return nil }

func (statsdFormat) line(s sample, tags []tag, kind string) string {
	letter := "c"
	if kind == "gauge" {
		letter = "g"
	}
	text := s.name + ":" + strconv.FormatInt(s.value, 10) + "|" + letter
	if len(tags) > 0 {
		parts := make([]string, len(tags))
		for i, t := range tags {
			parts[i] = t.key + ":" + t.value
		}
		text += "|#" + strings.Join(parts, ",")
	}
	return text
}

func pick(name string) format {
	switch name {
	case "prometheus":
		return prometheusFormat{}
	case "statsd":
		return statsdFormat{}
	}
	panic("unknown format")
}

type series struct {
	tags   []tag
	metric metric
}

// The bridge: metric kinds and export formats vary on their own. Each series keeps its
// numbers once; scraping asks the kind for its samples and hands each one to whichever
// format is current.
type MetricsExporter struct {
	format format
	kinds  map[string]string
	// name -> tag text -> series
	series map[string]map[string]*series
}

func NewMetricsExporter(format string) *MetricsExporter {
	return &MetricsExporter{format: pick(format), kinds: map[string]string{}, series: map[string]map[string]*series{}}
}

func (e *MetricsExporter) counter(name string, by int64, tags map[string]string) {
	if by < 0 {
		panic("a counter only goes up")
	}
	e.seriesFor(name, tags, "counter", func() metric { return &counterMetric{} }).add(by)
}

func (e *MetricsExporter) observe(name string, val int64, tags map[string]string) {
	if _, ok := tags["le"]; ok {
		panic("le is the histogram's own tag")
	}
	e.seriesFor(name, tags, "histogram", func() metric {
		return &histogramMetric{buckets: make([]int64, len(bounds))}
	}).add(val)
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func (e *MetricsExporter) scrape() []string {
	out := []string{}
	for _, name := range sortedKeys(e.series) {
		out = append(out, e.format.header(name, e.kinds[name])...)
		byTags := e.series[name]
		for _, key := range sortedKeys(byTags) {
			found := byTags[key]
			for _, s := range found.metric.samples(name) {
				tags := append(append([]tag{}, found.tags...), s.extra...)
				out = append(out, e.format.line(s, tags, found.metric.kind()))
			}
		}
	}
	return out
}

func (e *MetricsExporter) switchFormat(format string) {
	e.format = pick(format)
}

// The extension round: a third kind. Of the formats, only StatsD's letter changed.
func (e *MetricsExporter) gauge(name string, val int64, tags map[string]string) {
	e.seriesFor(name, tags, "gauge", func() metric { return &gaugeMetric{} }).add(val)
}

func (e *MetricsExporter) seriesFor(name string, tags map[string]string, kind string, make func() metric) metric {
	word(name, "")
	for key, value := range tags {
		word(key, "")
		word(value, "-.")
	}
	if known, ok := e.kinds[name]; ok && known != kind {
		panic("the name belongs to another kind")
	}
	ordered := []tag{}
	parts := []string{}
	for _, key := range sortedKeys(tags) {
		ordered = append(ordered, tag{key, tags[key]})
		parts = append(parts, key+"="+tags[key])
	}
	key := strings.Join(parts, ",")
	if e.series[name] == nil {
		e.series[name] = map[string]*series{}
	}
	found, ok := e.series[name][key]
	if !ok {
		found = &series{ordered, make()}
		e.series[name][key] = found
	}
	e.kinds[name] = kind
	return found.metric
}
