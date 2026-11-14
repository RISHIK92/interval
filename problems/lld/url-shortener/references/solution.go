package main

import (
	"strings"
	"sync"
)

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

type UrlShortener struct {
	// Every live code (generated or custom) to its url and hit count.
	urls   map[string]string
	counts map[string]int64
	// A url's generated code, so shortening it again gives the same one.
	generated map[string]string
	counter   int64
	mu        sync.Mutex
}

func NewUrlShortener() *UrlShortener {
	return &UrlShortener{urls: map[string]string{}, counts: map[string]int64{}, generated: map[string]string{}, counter: 1}
}

func checkURL(url string) {
	rest := ""
	if strings.HasPrefix(url, "https://") {
		rest = url[8:]
	} else if strings.HasPrefix(url, "http://") {
		rest = url[7:]
	}
	if rest == "" || len(url) > 2048 || strings.Contains(url, " ") {
		panic("invalid url")
	}
}

func encode(n int64) string {
	out := ""
	for n > 0 {
		out = string(alphabet[n%62]) + out
		n /= 62
	}
	return out
}

func (s *UrlShortener) shorten(url string) string {
	checkURL(url)
	s.mu.Lock()
	defer s.mu.Unlock()
	if code, ok := s.generated[url]; ok {
		return code
	}
	// A custom alias may already hold the next code: skip it.
	var code string
	for {
		code = encode(s.counter)
		s.counter++
		if _, taken := s.urls[code]; !taken {
			break
		}
	}
	s.urls[code] = url
	s.counts[code] = 0
	s.generated[url] = code
	return code
}

func (s *UrlShortener) expand(code string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	url, ok := s.urls[code]
	if !ok {
		panic("unknown code")
	}
	s.counts[code]++
	return url
}

func (s *UrlShortener) custom(url string, alias string) string {
	checkURL(url)
	if len(alias) < 1 || len(alias) > 16 {
		panic("invalid alias")
	}
	for _, c := range alias {
		if !strings.ContainsRune(alphabet, c) {
			panic("invalid alias")
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, taken := s.urls[alias]; taken {
		panic("alias taken")
	}
	s.urls[alias] = url
	s.counts[alias] = 0
	return alias
}

func (s *UrlShortener) hits(code string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.counts[code]
	if !ok {
		panic("unknown code")
	}
	return n
}

func (s *UrlShortener) expire(code string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	url, ok := s.urls[code]
	if !ok {
		panic("unknown code")
	}
	delete(s.urls, code)
	delete(s.counts, code)
	if s.generated[url] == code {
		delete(s.generated, url)
	}
}
