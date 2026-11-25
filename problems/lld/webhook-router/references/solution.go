package main

import "strings"

type eventMatcher interface {
	matches(event string) bool
}

type exactMatcher struct{ name string }

func (m exactMatcher) matches(event string) bool { return event == m.name }

type prefixMatcher struct{ prefix string }

func (m prefixMatcher) matches(event string) bool { return strings.HasPrefix(event, m.prefix) }

type anythingMatcher struct{}

func (anythingMatcher) matches(string) bool { return true }

// Each kind of matcher recognises its own patterns. A new kind is a new entry here and a
// new type; the router and the existing kinds never change.
var matcherKinds = []func(pattern string) eventMatcher{
	func(pattern string) eventMatcher {
		if strings.Contains(pattern, "*") {
			return nil
		}
		return exactMatcher{pattern}
	},
	func(pattern string) eventMatcher {
		stem, ok := strings.CutSuffix(pattern, ".*")
		if !ok || stem == "" || strings.Contains(stem, "*") {
			return nil
		}
		return prefixMatcher{stem + "."}
	},
	func(pattern string) eventMatcher {
		if pattern != "*" {
			return nil
		}
		return anythingMatcher{}
	},
}

func newMatcher(pattern string) eventMatcher {
	for _, kind := range matcherKinds {
		if found := kind(pattern); found != nil {
			return found
		}
	}
	panic("not a pattern")
}

func routerNamed(text string) string {
	if text == "" {
		panic("an empty name")
	}
	return text
}

type webhookRoute struct {
	pattern, handler string
	matcher          eventMatcher
}

type WebhookRouter struct {
	routes     []webhookRoute
	exclusions map[string]map[string]eventMatcher
}

func NewWebhookRouter() *WebhookRouter {
	return &WebhookRouter{exclusions: map[string]map[string]eventMatcher{}}
}

func (r *WebhookRouter) route(pattern string, handler string) {
	found := newMatcher(routerNamed(pattern))
	routerNamed(handler)
	for _, existing := range r.routes {
		if existing.pattern == pattern && existing.handler == handler {
			return
		}
	}
	r.routes = append(r.routes, webhookRoute{pattern, handler, found})
}

func (r *WebhookRouter) deliver(event string) []string {
	if strings.Contains(routerNamed(event), "*") {
		panic("an event has no wildcard")
	}
	handlers := []string{}
	seen := map[string]bool{}
	for _, route := range r.routes {
		if !seen[route.handler] && route.matcher.matches(event) && !r.excluded(route.handler, event) {
			seen[route.handler] = true
			handlers = append(handlers, route.handler)
		}
	}
	return handlers
}

func (r *WebhookRouter) unroute(handler string) int64 {
	routerNamed(handler)
	kept := []webhookRoute{}
	for _, route := range r.routes {
		if route.handler != handler {
			kept = append(kept, route)
		}
	}
	removed := int64(len(r.routes) - len(kept))
	r.routes = kept
	delete(r.exclusions, handler)
	return removed
}

// The extension round: a negative matcher is any matcher, used to skip a handler.
func (r *WebhookRouter) exclude(handler string, pattern string) {
	found := newMatcher(routerNamed(pattern))
	own, ok := r.exclusions[routerNamed(handler)]
	if !ok {
		own = map[string]eventMatcher{}
		r.exclusions[handler] = own
	}
	if _, has := own[pattern]; !has {
		own[pattern] = found
	}
}

func (r *WebhookRouter) excluded(handler string, event string) bool {
	for _, m := range r.exclusions[handler] {
		if m.matches(event) {
			return true
		}
	}
	return false
}
