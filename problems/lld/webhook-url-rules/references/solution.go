package main

import (
	"fmt"
	"strconv"
	"strings"
)

const maxURLLength = 200

// The URL's host in lower case: after the first "://", up to the path, query or
// fragment, without a port. Empty when there's no "://".
func hostOf(url string) string {
	_, rest, found := strings.Cut(url, "://")
	if !found {
		return ""
	}
	if cut := strings.IndexAny(rest, "/?#:"); cut >= 0 {
		rest = rest[:cut]
	}
	return strings.ToLower(rest)
}

func ipv4(host string) []int {
	parts := strings.Split(host, ".")
	if len(parts) != 4 {
		return nil
	}
	numbers := []int{}
	for _, p := range parts {
		if len(p) < 1 || len(p) > 3 || strings.Trim(p, "0123456789") != "" {
			return nil
		}
		n, _ := strconv.Atoi(p)
		if n > 255 {
			return nil
		}
		numbers = append(numbers, n)
	}
	return numbers
}

func internal(host string) bool {
	if host == "" || host == "localhost" {
		return true
	}
	ip := ipv4(host)
	if ip == nil {
		return false
	}
	return ip[0] == 10 || ip[0] == 127 || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] == 192 && ip[1] == 168)
}

// The one place the URL rules live. Every entry point asks it, so a new rule is one
// change here and can never apply at one entry point and not another.
type urlPolicy struct {
	blocked map[string]bool
}

func (p *urlPolicy) violations(url string) []string {
	if url == "" {
		panic("a URL is not empty")
	}
	host := hostOf(url)
	found := []string{}
	if len(url) > maxURLLength {
		found = append(found, "length")
	}
	if !strings.HasPrefix(url, "https://") {
		found = append(found, "scheme")
	}
	if internal(host) {
		found = append(found, "host")
	}
	if p.blocked[host] {
		found = append(found, "blocked")
	}
	return found
}

type WebhookRules struct {
	policy *urlPolicy
	ids    []string // in creation order
	urls   map[string]string
}

func NewWebhookRules() *WebhookRules {
	return &WebhookRules{policy: &urlPolicy{blocked: map[string]bool{}}, urls: map[string]string{}}
}

func (w *WebhookRules) createHook(url string) []string {
	found := w.policy.violations(url)
	if len(found) == 0 {
		id := fmt.Sprintf("hook-%d", len(w.ids)+1)
		w.ids = append(w.ids, id)
		w.urls[id] = url
	}
	return found
}

func (w *WebhookRules) updateHook(hookID string, url string) []string {
	if _, ok := w.urls[hookID]; !ok {
		panic("no such hook")
	}
	found := w.policy.violations(url)
	if len(found) == 0 {
		w.urls[hookID] = url
	}
	return found
}

func (w *WebhookRules) testUrl(url string) []string {
	return w.policy.violations(url)
}

func (w *WebhookRules) hooks() []string {
	out := []string{}
	for _, id := range w.ids {
		out = append(out, id+" "+w.urls[id])
	}
	return out
}

// The extension round: one more rule, in the one place rules live.
func (w *WebhookRules) blockHost(host string) {
	if host == "" {
		panic("a host is not empty")
	}
	w.policy.blocked[strings.ToLower(host)] = true
}
