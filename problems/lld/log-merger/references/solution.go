package main

import (
	"sort"
	"strconv"
)

const earliest = 0

type mergedLine struct {
	ts   int64
	text string
}

type mergedStream struct {
	name  string
	lines []mergedLine
	head  int // the first line not yet returned or passed
}

// Whether (ts, name) comes before (atTs, atName): time first, then stream name.
func before(ts int64, name string, atTs int64, atName string) bool {
	if ts != atTs {
		return ts < atTs
	}
	return name < atName
}

// An iterator over many time-ordered streams at once. Its position is the (time, stream)
// of the last line it returned or skipped to; each stream keeps its own head, so lines
// added later slot in without rebuilding anything.
type LogMerger struct {
	streams map[string]*mergedStream
	hidden  map[string]bool
	atTs    int64
	atName  string
}

func NewLogMerger() *LogMerger {
	return &LogMerger{streams: map[string]*mergedStream{}, hidden: map[string]bool{}, atTs: earliest}
}

// The stream's first line at or after the position. Lines behind it (skipped, or passed
// while the stream was hidden) are dropped for good.
func (m *LogMerger) first(s *mergedStream) *mergedLine {
	for i := s.head; i < len(s.lines); i++ {
		if !before(s.lines[i].ts, s.name, m.atTs, m.atName) {
			s.head = i
			return &s.lines[i]
		}
	}
	s.head = len(s.lines)
	return nil
}

func (m *LogMerger) visible() []*mergedStream {
	names := []string{}
	for name := range m.streams {
		if !m.hidden[name] {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	out := make([]*mergedStream, len(names))
	for i, name := range names {
		out[i] = m.streams[name]
	}
	return out
}

func (m *LogMerger) peek() *mergedStream {
	var best *mergedStream
	for _, s := range m.visible() {
		line := m.first(s)
		if line != nil && (best == nil || line.ts < best.lines[best.head].ts) {
			best = s
		}
	}
	return best
}

func (m *LogMerger) addLine(stream string, ts int64, line string) bool {
	if stream == "" || line == "" || ts < earliest {
		panic("an empty name or line, or a negative time")
	}
	found, ok := m.streams[stream]
	if (ok && ts < found.lines[len(found.lines)-1].ts) || before(ts, stream, m.atTs, m.atName) {
		return false
	}
	if !ok {
		found = &mergedStream{name: stream}
		m.streams[stream] = found
	}
	found.lines = append(found.lines, mergedLine{ts, line})
	return true
}

func (m *LogMerger) hasNext() bool {
	return m.peek() != nil
}

func (m *LogMerger) next() string {
	best := m.peek()
	if best == nil {
		panic("no more lines")
	}
	line := best.lines[best.head]
	best.head++
	m.atTs, m.atName = line.ts, best.name
	return strconv.FormatInt(line.ts, 10) + " " + best.name + " " + line.text
}

func (m *LogMerger) skipUntil(ts int64) int64 {
	if ts < earliest {
		panic("a negative time")
	}
	var skipped int64
	for _, s := range m.visible() {
		if m.first(s) == nil {
			continue
		}
		for _, line := range s.lines[s.head:] {
			if line.ts < ts {
				skipped++
			}
		}
	}
	// Moving the position is the skip: every line behind it is dropped when reached.
	if before(m.atTs, m.atName, ts, "") {
		m.atTs, m.atName = ts, ""
	}
	return skipped
}

// The extension round: a hidden stream is passed over, not held back.
func (m *LogMerger) filterStream(stream string, on bool) {
	if stream == "" {
		panic("an empty stream")
	}
	if on {
		m.hidden[stream] = true
	} else {
		delete(m.hidden, stream)
	}
}
