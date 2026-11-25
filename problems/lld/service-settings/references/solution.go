package main

import "fmt"

const (
	minWorkers = 1
	maxWorkers = 64
	maxRetries = 10
)

func expect(holds bool, what string) {
	if !holds {
		panic(what)
	}
}

func validWorkers(n int64) bool {
	return n >= minWorkers && n <= maxWorkers
}

// Every precondition is checked once, at construction: a ServiceSettings that exists is
// valid, and no later call can make it invalid (its class invariant).
type ServiceSettings struct {
	port      int64
	workers   int64
	timeoutMs int64
	tls       *[2]string // certificate and key paths: both or neither
}

func NewServiceSettings(port int64, workers int64, timeoutMs int64) *ServiceSettings {
	expect(port >= 1 && port <= 65535, "port is from 1 to 65535")
	expect(validWorkers(workers), "workers is from 1 to 64")
	expect(timeoutMs >= 1 && timeoutMs <= 60000, "timeoutMs is from 1 to 60000")
	return &ServiceSettings{port: port, workers: workers, timeoutMs: timeoutMs}
}

func (s *ServiceSettings) withWorkers(n int64) bool {
	if !validWorkers(n) {
		return false
	}
	s.workers = n
	return true
}

func (s *ServiceSettings) budgetMs(retries int64) int64 {
	expect(retries >= 0 && retries <= maxRetries, "retries is from 0 to 10")
	return s.timeoutMs * (retries + 1)
}

func (s *ServiceSettings) describe() string {
	text := fmt.Sprintf("port=%d workers=%d timeoutMs=%d", s.port, s.workers, s.timeoutMs)
	if s.tls != nil {
		text += fmt.Sprintf(" tls=%s,%s", s.tls[0], s.tls[1])
	}
	return text
}

// The extension round: TLS is both paths or neither, never half configured.
func (s *ServiceSettings) withTls(certPath string, keyPath string) bool {
	if (certPath == "") != (keyPath == "") {
		return false
	}
	if certPath == "" {
		s.tls = nil
	} else {
		s.tls = &[2]string{certPath, keyPath}
	}
	return true
}
