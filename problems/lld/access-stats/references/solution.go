package main

import (
	"sort"
	"strconv"
	"strings"
)

var accessMethods = map[string]bool{"GET": true, "HEAD": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true}

const (
	maxLatency = 60_000
	maxTop     = 100
)

type accessRequest struct {
	path    string
	status  int64
	latency int64
}

func accessDigits(text string, most int) (int64, bool) {
	if len(text) < 1 || len(text) > most {
		return 0, false
	}
	for _, c := range text {
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	value, err := strconv.ParseInt(text, 10, 64)
	return value, err == nil
}

// Parsing: one line in, one request or nothing out. It knows the format and nothing else.
func parseAccess(line string) (accessRequest, bool) {
	parts := strings.Split(line, " ")
	if len(parts) != 4 || !accessMethods[parts[0]] || !strings.HasPrefix(parts[1], "/") {
		return accessRequest{}, false
	}
	status, statusOk := accessDigits(parts[2], 3)
	latency, latencyOk := accessDigits(parts[3], 5)
	if !statusOk || status < 100 || status > 599 || !latencyOk || latency > maxLatency {
		return accessRequest{}, false
	}
	path, _, _ := strings.Cut(parts[1], "?")
	return accessRequest{path, status, latency}, true
}

// Aggregation: running totals of what was parsed. It never sees a raw line or a report.
type accessTotals struct {
	requests, errors int64
	latencies        map[string][]int64
	classes          map[string]int64
}

func (t *accessTotals) add(request accessRequest) {
	t.requests++
	if request.status >= 500 {
		t.errors++
	}
	t.latencies[request.path] = append(t.latencies[request.path], request.latency)
	t.classes[strconv.FormatInt(request.status/100, 10)+"xx"]++
}

// Reporting: answers computed from the totals, which it only reads.
func accessTopPaths(t *accessTotals, n int64) []string {
	ranked := []string{}
	for path := range t.latencies {
		ranked = append(ranked, path)
	}
	sort.Slice(ranked, func(i, j int) bool {
		a, b := len(t.latencies[ranked[i]]), len(t.latencies[ranked[j]])
		return a > b || a == b && ranked[i] < ranked[j]
	})
	if int64(len(ranked)) > n {
		ranked = ranked[:n]
	}
	return ranked
}

func accessErrorRate(t *accessTotals) float64 {
	if t.requests == 0 {
		return 0
	}
	return float64(t.errors) / float64(t.requests)
}

func accessMedian(latencies []int64) int64 {
	sorted := append([]int64{}, latencies...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	return sorted[(len(sorted)-1)/2]
}

type AccessStats struct {
	totals *accessTotals
}

func NewAccessStats() *AccessStats {
	return &AccessStats{&accessTotals{latencies: map[string][]int64{}, classes: map[string]int64{}}}
}

func (s *AccessStats) ingest(line string) bool {
	if line == "" {
		panic("an empty line")
	}
	request, ok := parseAccess(line)
	if !ok {
		return false
	}
	s.totals.add(request)
	return true
}

func (s *AccessStats) topPaths(n int64) []string {
	if n < 1 || n > maxTop {
		panic("n is 1 to 100")
	}
	return accessTopPaths(s.totals, n)
}

func (s *AccessStats) errorRate() float64 {
	return accessErrorRate(s.totals)
}

func (s *AccessStats) p50(path string) int64 {
	latencies, ok := s.totals.latencies[path]
	if !ok {
		panic("no requests for that path")
	}
	return accessMedian(latencies)
}

// The extension round.
func (s *AccessStats) byStatusClass() map[string]int64 {
	out := map[string]int64{}
	for class, count := range s.totals.classes {
		out[class] = count
	}
	return out
}
