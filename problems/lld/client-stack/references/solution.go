package main

const (
	failure   = 500  // a status of at least this is a failure
	backoffMs = 100  // the wait before the first retry; it doubles for each one after
	openMs    = 1000 // how long a breaker stays open
)

type answer struct {
	status, took int64
}

// Every layer, and the transport at the bottom, has the same call: a request for a path
// that starts at time t returns its status and how long it took. A layer wraps the one
// below it and never knows what that is.
type layer interface {
	call(path string, t int64) answer
}

// One path's scripted answers: in order, then the last one again and again.
type script struct {
	answers []answer
	served  int
}

func (s *script) next() answer {
	a := s.answers[min(s.served, len(s.answers)-1)]
	s.served++
	return a
}

type transport struct {
	scripts map[string]*script
	calls   int64
}

func (tr *transport) call(path string, _ int64) answer {
	tr.calls++
	return tr.scripts[path].next()
}

type retry struct {
	inner   layer
	retries int64
}

func (r *retry) call(path string, t int64) answer {
	var spent int64
	var a answer
	for attempt := int64(0); attempt <= r.retries; attempt++ {
		if attempt > 0 {
			spent += backoffMs << (attempt - 1)
		}
		a = r.inner.call(path, t+spent)
		spent += a.took
		if a.status < failure {
			break
		}
	}
	return answer{a.status, spent}
}

type cache struct {
	inner  layer
	ttl    int64
	stored map[string]int64 // path -> when its 200 arrived
}

func (c *cache) call(path string, t int64) answer {
	if at, ok := c.stored[path]; ok && at <= t && t < at+c.ttl {
		return answer{200, 0}
	}
	a := c.inner.call(path, t)
	if a.status == 200 {
		c.stored[path] = t + a.took
	}
	return a
}

type breaker struct {
	inner     layer
	threshold int64
	failures  int64
	isOpen    bool
	opened    int64
}

func (b *breaker) call(path string, t int64) answer {
	if b.isOpen && b.opened <= t && t < b.opened+openMs {
		return answer{503, 0}
	}
	a := b.inner.call(path, t)
	if a.status < failure {
		b.failures = 0
		return a
	}
	b.failures++
	if b.failures >= b.threshold {
		b.isOpen, b.opened = true, t+a.took
		// It stays at the threshold, so after the cooldown one more failure reopens it
		// straight away. A success only resets the count; an open window runs out on its own.
		b.failures = b.threshold
	}
	return a
}

type hedgeLayer struct {
	inner layer
	after int64
}

func (h *hedgeLayer) call(path string, t int64) answer {
	first := h.inner.call(path, t)
	if first.took <= h.after {
		return first
	}
	second := h.inner.call(path, t+h.after)
	if h.after+second.took < first.took {
		return answer{second.status, h.after + second.took}
	}
	return first
}

// A decorator stack over a scripted transport: each wrap puts a layer outside the ones
// already there, so the order of the wraps decides what each layer sees.
type ClientStack struct {
	transport *transport
	top       layer
	elapsed   int64
}

func NewClientStack() *ClientStack {
	tr := &transport{scripts: map[string]*script{}}
	return &ClientStack{transport: tr, top: tr}
}

func (s *ClientStack) script(path string, statuses []int64, latenciesMs []int64) {
	if path == "" || len(statuses) == 0 || len(statuses) != len(latenciesMs) {
		panic("a path and one latency per status")
	}
	answers := make([]answer, len(statuses))
	for i, status := range statuses {
		if status < 100 || status > 599 {
			panic("not an HTTP status")
		}
		if latenciesMs[i] < 0 {
			panic("a negative latency")
		}
		answers[i] = answer{status, latenciesMs[i]}
	}
	s.transport.scripts[path] = &script{answers: answers}
}

func (s *ClientStack) wrap(name string, param int64) {
	if param < 1 || (name == "retry" && param > 5) {
		panic("a parameter out of range")
	}
	switch name {
	case "retry":
		s.top = &retry{inner: s.top, retries: param}
	case "cache":
		s.top = &cache{inner: s.top, ttl: param, stored: map[string]int64{}}
	case "breaker":
		s.top = &breaker{inner: s.top, threshold: param}
	default:
		panic("unknown layer")
	}
}

func (s *ClientStack) fetch(path string, nowMs int64) int64 {
	if _, ok := s.transport.scripts[path]; !ok {
		panic("an unscripted path")
	}
	a := s.top.call(path, nowMs)
	s.elapsed = a.took
	return a.status
}

func (s *ClientStack) upstreamCalls() int64 {
	return s.transport.calls
}

func (s *ClientStack) elapsedMs() int64 {
	return s.elapsed
}

// The extension round: one more layer, which only needs the same call as the rest.
func (s *ClientStack) hedge(afterMs int64) {
	if afterMs < 0 {
		panic("a negative delay")
	}
	s.top = &hedgeLayer{inner: s.top, after: afterMs}
}
