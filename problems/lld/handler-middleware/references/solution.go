package main

import (
	"strconv"
	"strings"
)

const (
	hmOK           = 200
	hmUnauthorized = 401
	hmBearer       = "Bearer "
)

// A handler, or a layer that looks like one.
type hmHandler interface {
	serve(path, token string, trace *[]string) int
}

// The innermost handler: it serves every request it's given.
type hmEndpoint struct{ name string }

func (h *hmEndpoint) serve(path, token string, trace *[]string) int {
	*trace = append(*trace, h.name+" "+path)
	return hmOK
}

// A decorator: it holds the handler it wraps and adds its own lines around the call. Each
// kind changes only the part it's about.
type hmLayer struct {
	name    string
	inner   hmHandler
	entered func() string
	inside  func(path, token string, trace *[]string) int
	left    func(status int) string
}

func (l *hmLayer) serve(path, token string, trace *[]string) int {
	*trace = append(*trace, l.entered())
	status := l.inside(path, token, trace)
	*trace = append(*trace, l.left(status))
	return status
}

func hmNewLayer(name string, inner hmHandler) *hmLayer {
	l := &hmLayer{name: name, inner: inner}
	l.entered = func() string { return "enter " + name }
	l.inside = inner.serve
	l.left = func(int) string { return "leave " + name }
	return l
}

var hmKinds = map[string]func(l *hmLayer){
	"auth": func(l *hmLayer) {
		pass := l.inside
		l.inside = func(path, token string, trace *[]string) int {
			if !strings.HasPrefix(token, hmBearer) || len(token) == len(hmBearer) {
				*trace = append(*trace, "deny")
				return hmUnauthorized
			}
			return pass(path, token, trace)
		}
	},
	"request-id": func(l *hmLayer) {
		seen := 0
		enter := l.entered
		l.entered = func() string {
			seen++
			return enter() + " " + strconv.Itoa(seen)
		}
	},
	"compress": func(l *hmLayer) {
		leave := l.left
		l.left = func(status int) string {
			if status == hmOK {
				return leave(status) + " gzip"
			}
			return leave(status)
		}
	},
}

// A handler wrapped in layers, the last one wrapped outermost.
type HandlerStack struct {
	top     hmHandler
	wrapped []*hmLayer
}

func NewHandlerStack(handler string) *HandlerStack {
	if handler == "" {
		panic("empty handler")
	}
	return &HandlerStack{top: &hmEndpoint{name: handler}}
}

func (s *HandlerStack) wrap(layer string) {
	kind, ok := hmKinds[layer]
	if !ok {
		panic("unknown layer")
	}
	outer := hmNewLayer(layer, s.top)
	kind(outer)
	s.wrapped = append(s.wrapped, outer)
	s.top = outer
}

func (s *HandlerStack) handle(path string, token string) []string {
	if path == "" || token == "" {
		panic("empty path or token")
	}
	trace := []string{}
	status := s.top.serve(path, token, &trace)
	return append(trace, strconv.Itoa(status))
}

func (s *HandlerStack) layers() []string {
	names := []string{}
	for i := len(s.wrapped) - 1; i >= 0; i-- {
		names = append(names, s.wrapped[i].name)
	}
	return names
}

// The extension round: peeling the outermost layer off again.
func (s *HandlerStack) unwrap() bool {
	if len(s.wrapped) == 0 {
		return false
	}
	outer := s.wrapped[len(s.wrapped)-1]
	s.wrapped = s.wrapped[:len(s.wrapped)-1]
	s.top = outer.inner
	return true
}
