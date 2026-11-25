package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var fileSpec = regexp.MustCompile(`^file:(/[^ ]*)$`)
var syslogSpec = regexp.MustCompile(`^syslog:([A-Za-z0-9.-]+):([1-9][0-9]{0,4})$`)

const portLimit = 65535

// What every product of the factory can do. Callers hold a sink id and never learn which
// type is behind it.
type sink interface {
	kind() string
	write(line string) string
}

type stdoutSink struct{}

func (stdoutSink) kind() string             { return "stdout" }
func (stdoutSink) write(line string) string { return line }

type fileSink struct {
	path    string
	written int64
}

func (*fileSink) kind() string { return "file" }
func (f *fileSink) write(line string) string {
	f.written++
	return fmt.Sprintf("%s:%d %s", f.path, f.written, line)
}

type syslogSink struct{ address string }

func (*syslogSink) kind() string { return "syslog" }
func (s *syslogSink) write(line string) string {
	return "<14>" + s.address + " " + line
}

type bufferedSink struct {
	capacity int
	held     []string
}

func (*bufferedSink) kind() string { return "buffered" }
func (b *bufferedSink) write(line string) string {
	b.held = append(b.held, line)
	if len(b.held) > b.capacity {
		b.held = b.held[1:]
	}
	return ""
}
func (b *bufferedSink) drain() []string {
	out := append([]string{}, b.held...)
	b.held = nil
	return out
}

// The creation step, a parameterised factory (the simple form of factory method): the
// spec decides which type to make, and only here.
func parseSink(spec string) sink {
	if spec == "stdout" {
		return stdoutSink{}
	}
	if m := fileSpec.FindStringSubmatch(spec); m != nil && !strings.HasSuffix(spec, "/") {
		return &fileSink{path: m[1]}
	}
	if m := syslogSpec.FindStringSubmatch(spec); m != nil {
		// The pattern allows only 1 to 5 digits, so Atoi can't fail here.
		if port, _ := strconv.Atoi(m[2]); port <= portLimit {
			return &syslogSink{address: m[1] + ":" + m[2]}
		}
	}
	panic("malformed spec")
}

func filled(text string) {
	if text == "" {
		panic("not empty")
	}
}

type SinkFactory struct {
	sinks map[string]sink
	made  map[string]int64
}

func NewSinkFactory() *SinkFactory {
	return &SinkFactory{sinks: map[string]sink{}, made: map[string]int64{}}
}

func (f *SinkFactory) keep(s sink) string {
	f.made[s.kind()]++
	id := fmt.Sprintf("%s-%d", s.kind(), f.made[s.kind()])
	f.sinks[id] = s
	return id
}

func (f *SinkFactory) find(id string) sink {
	found, ok := f.sinks[id]
	if !ok {
		panic("unknown sink")
	}
	return found
}

func (f *SinkFactory) create(spec string) string {
	return f.keep(parseSink(spec))
}

func (f *SinkFactory) kindOf(id string) string {
	return f.find(id).kind()
}

func (f *SinkFactory) writeLine(id string, line string) string {
	found := f.find(id)
	filled(line)
	return found.write(line)
}

func (f *SinkFactory) created(kind string) int64 {
	filled(kind)
	return f.made[kind]
}

// The extension round: one more product, made by its own method.
func (f *SinkFactory) createBuffered(capacity int64) string {
	if capacity < 1 || capacity > 1000 {
		panic("capacity is 1 to 1000")
	}
	return f.keep(&bufferedSink{capacity: int(capacity)})
}

func (f *SinkFactory) flush(id string) []string {
	buffered, ok := f.find(id).(*bufferedSink)
	if !ok {
		panic("only a buffered sink holds lines")
	}
	return buffered.drain()
}
