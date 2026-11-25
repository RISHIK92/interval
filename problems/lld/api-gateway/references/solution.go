package main

import (
	"strconv"
	"strings"
)

const none = "-"

func checkPath(path string) {
	if !strings.HasPrefix(path, "/") {
		panic("a path starts with /")
	}
}

func checkPrefix(prefix string) {
	checkPath(prefix)
	if prefix != "/" && strings.HasSuffix(prefix, "/") {
		panic("only / itself ends with /")
	}
}

func matches(prefix, path string) bool {
	return prefix == "/" || path == prefix || strings.HasPrefix(path, prefix+"/")
}

// Prefixes that match one path are nested, so the longest is the most specific.
func longest[V any](prefixes map[string]V, path string) (string, bool) {
	best, found := "", false
	for prefix := range prefixes {
		if matches(prefix, path) && (!found || len(prefix) > len(best)) {
			best, found = prefix, true
		}
	}
	return best, found
}

// A fake upstream: answers with its statuses in order, then repeats the last.
type scriptedService struct {
	statuses []int64
	served   int
}

func (s *scriptedService) answer() int64 {
	status := s.statuses[min(s.served, len(s.statuses)-1)]
	s.served++
	return status
}

type cachedResponse struct {
	status, expires int64
}

// One prefix's settings and, when it caches, its own responses by path.
type route struct {
	service string
	auth    bool
	ttl     int64
	cached  map[string]cachedResponse
}

// The facade: one request call hides routing, the auth check, the response cache (a
// proxy in front of each service) and the services themselves.
type Gateway struct {
	routes   map[string]*route
	services map[string]*scriptedService
	rewrites map[string]string
}

func NewGateway() *Gateway {
	return &Gateway{routes: map[string]*route{}, services: map[string]*scriptedService{}, rewrites: map[string]string{}}
}

func (g *Gateway) route(prefix string, service string) {
	checkPrefix(prefix)
	if service == "" {
		panic("an empty service")
	}
	if found, ok := g.routes[prefix]; ok {
		found.service = service
		found.cached = map[string]cachedResponse{}
		return
	}
	g.routes[prefix] = &route{service: service, cached: map[string]cachedResponse{}}
}

func (g *Gateway) requireAuth(prefix string) {
	g.find(prefix).auth = true
}

func (g *Gateway) cache(prefix string, ttlMs int64) {
	r := g.find(prefix)
	if ttlMs < 1 {
		panic("a ttl is at least 1 ms")
	}
	r.ttl = ttlMs
}

func (g *Gateway) upstream(service string, statuses []int64) {
	if service == "" || len(statuses) == 0 {
		panic("an empty service or script")
	}
	for _, s := range statuses {
		if s < 100 || s > 599 {
			panic("not an HTTP status")
		}
	}
	g.services[service] = &scriptedService{statuses: append([]int64{}, statuses...)}
}

func (g *Gateway) request(path string, token string, nowMs int64) []string {
	checkPath(path)
	if rewrite, ok := longest(g.rewrites, path); ok {
		path = g.rewrites[rewrite] + path[len(rewrite):]
	}
	prefix, ok := longest(g.routes, path)
	if !ok {
		return []string{"404", none, none}
	}
	r := g.routes[prefix]
	if r.auth && token == "" {
		return []string{"401", none, none}
	}
	if kept, ok := r.cached[path]; ok && nowMs < kept.expires {
		return []string{strconv.FormatInt(kept.status, 10), r.service, "hit"}
	}
	service, ok := g.services[r.service]
	if !ok {
		return []string{"502", none, none}
	}
	status := service.answer()
	if r.ttl == 0 {
		return []string{strconv.FormatInt(status, 10), r.service, none}
	}
	if status == 200 {
		r.cached[path] = cachedResponse{status, nowMs + r.ttl}
	}
	return []string{strconv.FormatInt(status, 10), r.service, "miss"}
}

// The extension round: a path rewrite in front of the routing.
func (g *Gateway) rewrite(prefix string, replacement string) {
	checkPrefix(prefix)
	checkPrefix(replacement)
	if prefix == "/" || replacement == "/" {
		panic("/ can't be rewritten or be a rewrite")
	}
	g.rewrites[prefix] = replacement
}

func (g *Gateway) find(prefix string) *route {
	r, ok := g.routes[prefix]
	if !ok {
		panic("no such route")
	}
	return r
}
