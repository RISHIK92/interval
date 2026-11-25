package main

import "strings"

const hole = "{}"

// The flyweight: a message pattern split once into its literal parts. It holds nothing
// about any one event, so every event with this pattern shares it.
type template struct {
	parts []string
}

func newTemplate(pattern string) *template {
	return &template{parts: strings.Split(pattern, hole)}
}

func (t *template) holes() int {
	return len(t.parts) - 1
}

func (t *template) render(params []string) string {
	var out strings.Builder
	out.WriteString(t.parts[0])
	for i, param := range params {
		out.WriteString(param)
		out.WriteString(t.parts[i+1])
	}
	return out.String()
}

type logEvent struct {
	template *template
	params   []string
}

// Events keep only their own parameters and a reference to their template.
type LogStore struct {
	byText map[string]*template
	events map[int64]logEvent
	ids    map[string][]int64
	last   int64
}

func NewLogStore() *LogStore {
	return &LogStore{byText: map[string]*template{}, events: map[int64]logEvent{}, ids: map[string][]int64{}}
}

func (s *LogStore) log(pattern string, params []string) int64 {
	if pattern == "" {
		panic("an empty pattern")
	}
	for _, param := range params {
		if param == "" {
			panic("an empty parameter")
		}
	}
	t, ok := s.byText[pattern]
	if !ok {
		t = newTemplate(pattern)
	}
	if t.holes() != len(params) {
		panic("one parameter per {}")
	}
	s.byText[pattern] = t
	s.last++
	s.events[s.last] = logEvent{t, append([]string{}, params...)}
	s.ids[pattern] = append(s.ids[pattern], s.last)
	return s.last
}

func (s *LogStore) render(eventId int64) string {
	event, ok := s.events[eventId]
	if !ok {
		panic("unknown event")
	}
	return event.template.render(event.params)
}

func (s *LogStore) templates() int64 {
	return int64(len(s.byText))
}

func (s *LogStore) byPattern(pattern string) []int64 {
	if pattern == "" {
		panic("an empty pattern")
	}
	return append([]int64{}, s.ids[pattern]...)
}

// The extension round: a pattern goes, and with it every event that shared it.
func (s *LogStore) purge(pattern string) int64 {
	if pattern == "" {
		panic("an empty pattern")
	}
	ids := s.ids[pattern]
	delete(s.byText, pattern)
	delete(s.ids, pattern)
	for _, id := range ids {
		delete(s.events, id)
	}
	return int64(len(ids))
}
