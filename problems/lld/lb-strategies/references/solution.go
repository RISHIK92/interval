package main

const lbMaxWeight = 100

type lbBackend struct {
	name    string
	weight  int64
	open    int64
	drained bool
}

type lbStrategy interface {
	choose(backends []*lbBackend) *lbBackend
}

// The backend after the one picked last, in the order they were added, wrapping.
type lbRoundRobin struct{ last int }

func (s *lbRoundRobin) choose(backends []*lbBackend) *lbBackend {
	count := len(backends)
	for step := 0; step < count; step++ {
		at := (s.last + 1 + step) % count
		if !backends[at].drained {
			s.last = at
			return backends[at]
		}
	}
	panic("no backend to pick")
}

// The backend with the fewest open connections; a tie goes to the one added first.
type lbLeastConnections struct{}

func (lbLeastConnections) choose(backends []*lbBackend) *lbBackend {
	var best *lbBackend
	for _, backend := range backends {
		if !backend.drained && (best == nil || backend.open < best.open) {
			best = backend
		}
	}
	if best == nil {
		panic("no backend to pick")
	}
	return best
}

// Smooth weighted round robin: every pick, each backend's current weight grows by its
// weight, the largest is picked (a tie goes to the one added first), and the pick gives
// back the total, so heavy backends are spread out instead of picked in a row.
type lbSmoothWeighted struct{ current map[string]int64 }

func (s *lbSmoothWeighted) choose(backends []*lbBackend) *lbBackend {
	var best *lbBackend
	var total int64
	for _, backend := range backends {
		if backend.drained {
			continue
		}
		total += backend.weight
		s.current[backend.name] += backend.weight
		if best == nil || s.current[backend.name] > s.current[best.name] {
			best = backend
		}
	}
	if best == nil {
		panic("no backend to pick")
	}
	s.current[best.name] -= total
	return best
}

var lbStrategies = map[string]func() lbStrategy{
	"round-robin":          func() lbStrategy { return &lbRoundRobin{last: -1} },
	"least-connections":    func() lbStrategy { return lbLeastConnections{} },
	"weighted-round-robin": func() lbStrategy { return &lbSmoothWeighted{current: map[string]int64{}} },
}

func lbFresh(strategy string) lbStrategy {
	build, known := lbStrategies[strategy]
	if !known {
		panic("unknown strategy")
	}
	return build()
}

// Picks a backend for each new connection with a strategy that can be swapped at
// runtime. The balancer owns the backends and their connection counts; a strategy owns
// only its own position, so a new one starts fresh and loses no connections.
type Balancer struct {
	backends []*lbBackend
	byName   map[string]*lbBackend
	strategy lbStrategy
}

func NewBalancer(strategy string) *Balancer {
	return &Balancer{byName: map[string]*lbBackend{}, strategy: lbFresh(strategy)}
}

func (b *Balancer) addBackend(name string, weight int64) {
	if _, taken := b.byName[name]; name == "" || taken || weight < 1 || weight > lbMaxWeight {
		panic("bad backend")
	}
	backend := &lbBackend{name: name, weight: weight}
	b.backends = append(b.backends, backend)
	b.byName[name] = backend
}

func (b *Balancer) pick() string {
	backend := b.strategy.choose(b.backends)
	backend.open++
	return backend.name
}

func (b *Balancer) done(backend string) {
	found := b.backend(backend)
	if found.open == 0 {
		panic("no open connection")
	}
	found.open--
}

func (b *Balancer) useStrategy(strategy string) {
	b.strategy = lbFresh(strategy)
}

// The extension round: taking a backend out of rotation.
func (b *Balancer) drain(backend string) {
	found := b.backend(backend)
	if found.drained {
		panic("already drained")
	}
	found.drained = true
}

func (b *Balancer) backend(name string) *lbBackend {
	found, known := b.byName[name]
	if !known {
		panic("unknown backend")
	}
	return found
}
