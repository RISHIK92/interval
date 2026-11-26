package main

import "strconv"

const otMaxSampleEvery = 1000

func otGiven(value string) {
	if value == "" {
		panic("empty name")
	}
}

type otTrace interface {
	span(name string) int64
	endSpan(spanId int64) bool
	recorded() []string
	// The trace that records from now on: itself if it already does.
	sampled() otTrace
}

// A sampled trace: spans get ids from 1, and each one is recorded when it ends.
type otRecordingTrace struct {
	open    map[int64]string
	started int64
	ended   []string
}

func (t *otRecordingTrace) span(name string) int64 {
	t.started++
	t.open[t.started] = name
	return t.started
}

func (t *otRecordingTrace) endSpan(spanId int64) bool {
	name, open := t.open[spanId]
	if !open {
		return false
	}
	delete(t.open, spanId)
	t.ended = append(t.ended, strconv.FormatInt(spanId, 10)+" "+name)
	return true
}

func (t *otRecordingTrace) recorded() []string {
	return append([]string{}, t.ended...)
}

func (t *otRecordingTrace) sampled() otTrace { return t }

// The null object: the same methods as a recording trace, and they never refuse and
// record nothing, so callers never check whether a trace is sampled.
type otNoopTrace struct{}

func (otNoopTrace) span(name string) int64    { return 0 }
func (otNoopTrace) endSpan(spanId int64) bool { return true }
func (otNoopTrace) recorded() []string        { return []string{} }
func (otNoopTrace) sampled() otTrace          { return otRecording() }

func otRecording() *otRecordingTrace {
	return &otRecordingTrace{open: map[int64]string{}}
}

// Samples one trace in every sampleEvery. The tracer checks arguments the same way for
// every trace, then hands the call to the trace, recording or not.
type Tracer struct {
	every  int64
	traces map[string]otTrace
}

func NewTracer(sampleEvery int64) *Tracer {
	if sampleEvery < 1 || sampleEvery > otMaxSampleEvery {
		panic("bad sampling rate")
	}
	return &Tracer{every: sampleEvery, traces: map[string]otTrace{}}
}

func (t *Tracer) startTrace(name string) string {
	otGiven(name)
	started := int64(len(t.traces))
	trace := name + "#" + strconv.FormatInt(started+1, 10)
	if started%t.every == 0 {
		t.traces[trace] = otRecording()
	} else {
		t.traces[trace] = otNoopTrace{}
	}
	return trace
}

func (t *Tracer) span(trace string, name string) int64 {
	found := t.trace(trace)
	otGiven(name)
	return found.span(name)
}

func (t *Tracer) endSpan(trace string, spanId int64) bool {
	return t.trace(trace).endSpan(spanId)
}

func (t *Tracer) recorded(trace string) []string {
	return t.trace(trace).recorded()
}

// The extension round: sampling a trace that wasn't.
func (t *Tracer) forceSample(trace string) {
	t.traces[trace] = t.trace(trace).sampled()
}

func (t *Tracer) trace(trace string) otTrace {
	found, known := t.traces[trace]
	if !known {
		panic("unknown trace")
	}
	return found
}
