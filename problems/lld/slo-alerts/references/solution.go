package main

const sloPermille = 1000
const sloPercent = 100

// An observer of one service. It speaks only when the service's burn crosses its
// threshold, in either direction, so it never repeats itself.
type sloWatcher struct {
	subscriber string
	threshold  int64
	alerting   bool
}

func (w *sloWatcher) update(burned int64) *string {
	burning := burned >= w.threshold
	if burning == w.alerting {
		return nil
	}
	w.alerting = burning
	message := w.subscriber + " recovered"
	if burning {
		message = w.subscriber + " burning"
	}
	return &message
}

// The subject: its request counts, and the watchers it tells after each change, in the
// order they first watched.
type sloService struct {
	good, bad int64
	watchers  []*sloWatcher
}

func (s *sloService) burned(allowed int64) int64 {
	total := s.good + s.bad
	if total == 0 {
		return 0
	}
	return s.bad * sloPermille * sloPercent / (total * allowed)
}

func (s *sloService) find(subscriber string) int {
	for i, w := range s.watchers {
		if w.subscriber == subscriber {
			return i
		}
	}
	return -1
}

type SloMonitor struct {
	// The error budget: how many requests in a thousand may fail.
	allowed  int64
	services map[string]*sloService
}

func NewSloMonitor(objectivePermille int64) *SloMonitor {
	if objectivePermille <= 0 || objectivePermille >= sloPermille {
		panic("an objective from 1 to 999 permille")
	}
	return &SloMonitor{allowed: sloPermille - objectivePermille, services: map[string]*sloService{}}
}

func (m *SloMonitor) service(name string) *sloService {
	found, ok := m.services[name]
	if !ok {
		found = &sloService{}
		m.services[name] = found
	}
	return found
}

func (m *SloMonitor) watch(subscriber string, service string, burnPercent int64) {
	if subscriber == "" || service == "" || burnPercent <= 0 || burnPercent > sloPercent {
		panic("an empty name or a threshold outside 1 to 100")
	}
	subject := m.service(service)
	if i := subject.find(subscriber); i >= 0 {
		subject.watchers[i].threshold = burnPercent
		return
	}
	subject.watchers = append(subject.watchers, &sloWatcher{subscriber: subscriber, threshold: burnPercent})
}

func (m *SloMonitor) observe(service string, good int64, bad int64) []string {
	if service == "" || good < 0 || bad < 0 {
		panic("an empty service or a negative count")
	}
	subject := m.service(service)
	subject.good += good
	subject.bad += bad
	burned := subject.burned(m.allowed)
	told := []string{}
	for _, w := range subject.watchers {
		if message := w.update(burned); message != nil {
			told = append(told, *message)
		}
	}
	return told
}

func (m *SloMonitor) budgetLeft(service string) int64 {
	if service == "" {
		panic("an empty service")
	}
	found, ok := m.services[service]
	if !ok {
		return sloPercent
	}
	return sloPercent - found.burned(m.allowed)
}

// The extension round: a watcher leaves, and coming back starts afresh at the end.
func (m *SloMonitor) unwatch(subscriber string, service string) bool {
	if subscriber == "" || service == "" {
		panic("an empty name")
	}
	found, ok := m.services[service]
	if !ok {
		return false
	}
	i := found.find(subscriber)
	if i < 0 {
		return false
	}
	found.watchers = append(found.watchers[:i], found.watchers[i+1:]...)
	return true
}
