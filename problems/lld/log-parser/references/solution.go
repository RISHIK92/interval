package main

import (
	"regexp"
	"strings"
)

var accessLine = regexp.MustCompile(`^([^ ]+) ([^ ]+) ([^ ]+) \[([^\]]+)\] "([^ "]+) ([^ "]+) ([^ "]+)" ([0-9]{3}) ([0-9]+|-)$`)

var accessKeys = []string{"host", "ident", "user", "time", "method", "path", "protocol", "status", "bytes"}

// One named way to read a line. Each kind reads it its own way: fields gives the line's
// fields, and false when it's malformed for this kind.
type logFormat interface {
	fields(line string) (map[string]string, bool)
}

type keyValueFormat struct{}

func (keyValueFormat) fields(line string) (map[string]string, bool) {
	out := map[string]string{}
	for _, token := range strings.Split(line, " ") {
		key, value, found := strings.Cut(token, "=")
		if _, seen := out[key]; !found || key == "" || seen {
			return nil, false
		}
		out[key] = value
	}
	return out, true
}

type csvFormat struct{ headers []string }

func (c csvFormat) fields(line string) (map[string]string, bool) {
	values := strings.Split(line, ",")
	if len(values) != len(c.headers) {
		return nil, false
	}
	out := map[string]string{}
	for i, h := range c.headers {
		out[h] = values[i]
	}
	return out, true
}

type accessFormat struct{}

func (accessFormat) fields(line string) (map[string]string, bool) {
	match := accessLine.FindStringSubmatch(line)
	if match == nil {
		return nil, false
	}
	out := map[string]string{}
	for i, k := range accessKeys {
		out[k] = match[i+1]
	}
	return out, true
}

type namedFormat struct {
	name   string
	format logFormat
	count  int64
}

type LogParser struct {
	formats []*namedFormat // in the order added
}

func NewLogParser() *LogParser {
	return &LogParser{}
}

func (p *LogParser) find(name string) *namedFormat {
	for _, f := range p.formats {
		if f.name == name {
			return f
		}
	}
	return nil
}

func (p *LogParser) mustFind(name string) *namedFormat {
	f := p.find(name)
	if f == nil {
		panic("no such format")
	}
	return f
}

func (p *LogParser) addFormat(name string, kind string, headers []string) {
	if name == "" || p.find(name) != nil {
		panic("a format needs a new, non-empty name")
	}
	var format logFormat
	switch {
	case kind == "csv":
		distinct := map[string]bool{}
		for _, h := range headers {
			distinct[h] = true
		}
		if len(headers) < 1 || len(headers) > 20 || distinct[""] || len(distinct) != len(headers) {
			panic("1-20 distinct, non-empty headers")
		}
		format = csvFormat{headers: append([]string{}, headers...)}
	case kind == "kv" && len(headers) == 0:
		format = keyValueFormat{}
	case kind == "access" && len(headers) == 0:
		format = accessFormat{}
	default:
		panic("unknown kind, or headers where none are taken")
	}
	p.formats = append(p.formats, &namedFormat{name: name, format: format})
}

func (p *LogParser) parse(format string, line string) map[string]string {
	chosen := p.mustFind(format)
	fields, ok := chosen.format.fields(line)
	if !ok {
		panic("malformed line")
	}
	chosen.count++
	return fields
}

func (p *LogParser) parsed(format string) int64 {
	return p.mustFind(format).count
}

// The extension round.
func (p *LogParser) detect(line string) *string {
	for _, f := range p.formats {
		if _, ok := f.format.fields(line); ok {
			name := f.name
			return &name
		}
	}
	return nil
}
