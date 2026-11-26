package main

const cbMaxThreshold = 1000
const cbMaxCoolDownMs = 1000000000

// One state's rules. Each event returns the state the breaker is in afterwards, so the
// breaker itself never asks which state it's in.
type cbState interface {
	name() string
	tick(b *CircuitBreaker, nowMs int64) cbState
	allow() bool
	success(b *CircuitBreaker, nowMs int64) cbState
	failure(b *CircuitBreaker, nowMs int64) cbState
	force(on bool) cbState
}

// Every state but the held one is held open by force(true) and unchanged by force(false).
func cbForce(s cbState, on bool) cbState {
	if on {
		return &cbForcedOpen{}
	}
	return s
}

type cbClosed struct{ failures int64 }

func (s *cbClosed) force(on bool) cbState                       { return cbForce(s, on) }
func (s *cbClosed) name() string                                { return "closed" }
func (s *cbClosed) tick(b *CircuitBreaker, nowMs int64) cbState { return s }
func (s *cbClosed) allow() bool                                 { return true }
func (s *cbClosed) success(b *CircuitBreaker, nowMs int64) cbState {
	s.failures = 0
	return s
}
func (s *cbClosed) failure(b *CircuitBreaker, nowMs int64) cbState {
	s.failures++
	if s.failures >= b.threshold {
		return &cbOpen{openedMs: nowMs}
	}
	return s
}

// Refuses every call until the cool-down has passed; outcomes of calls let through
// earlier change nothing.
type cbOpen struct{ openedMs int64 }

func (s *cbOpen) force(on bool) cbState { return cbForce(s, on) }
func (s *cbOpen) name() string          { return "open" }
func (s *cbOpen) tick(b *CircuitBreaker, nowMs int64) cbState {
	if nowMs >= s.openedMs+b.coolDownMs {
		return &cbHalfOpen{}
	}
	return s
}
func (s *cbOpen) allow() bool                                    { return false }
func (s *cbOpen) success(b *CircuitBreaker, nowMs int64) cbState { return s }
func (s *cbOpen) failure(b *CircuitBreaker, nowMs int64) cbState { return s }

// Lets one trial call through; only that call's outcome decides what comes next.
type cbHalfOpen struct{ trial bool }

func (s *cbHalfOpen) force(on bool) cbState                       { return cbForce(s, on) }
func (s *cbHalfOpen) name() string                                { return "half-open" }
func (s *cbHalfOpen) tick(b *CircuitBreaker, nowMs int64) cbState { return s }
func (s *cbHalfOpen) allow() bool {
	allowed := !s.trial
	s.trial = true
	return allowed
}
func (s *cbHalfOpen) success(b *CircuitBreaker, nowMs int64) cbState {
	if s.trial {
		return &cbClosed{}
	}
	return s
}
func (s *cbHalfOpen) failure(b *CircuitBreaker, nowMs int64) cbState {
	if s.trial {
		return &cbOpen{openedMs: nowMs}
	}
	return s
}

// The manual override: open, with no cool-down, until it's released.
type cbForcedOpen struct{}

func (s *cbForcedOpen) force(on bool) cbState {
	if on {
		return s
	}
	return &cbClosed{}
}
func (s *cbForcedOpen) name() string                                   { return "open" }
func (s *cbForcedOpen) tick(b *CircuitBreaker, nowMs int64) cbState    { return s }
func (s *cbForcedOpen) allow() bool                                    { return false }
func (s *cbForcedOpen) success(b *CircuitBreaker, nowMs int64) cbState { return s }
func (s *cbForcedOpen) failure(b *CircuitBreaker, nowMs int64) cbState { return s }

// Guards calls to a failing dependency. The breaker checks the time and hands every
// event to its current state object, which says what happens and what comes next.
type CircuitBreaker struct {
	threshold, coolDownMs int64
	current               cbState
	lastMs                int64
}

func NewCircuitBreaker(threshold int64, coolDownMs int64) *CircuitBreaker {
	if threshold < 1 || threshold > cbMaxThreshold || coolDownMs < 1 || coolDownMs > cbMaxCoolDownMs {
		panic("bad threshold or cool-down")
	}
	return &CircuitBreaker{threshold: threshold, coolDownMs: coolDownMs, current: &cbClosed{}}
}

func (b *CircuitBreaker) allow(nowMs int64) bool {
	return b.at(nowMs).allow()
}

func (b *CircuitBreaker) success(nowMs int64) {
	b.current = b.at(nowMs).success(b, nowMs)
}

func (b *CircuitBreaker) failure(nowMs int64) {
	b.current = b.at(nowMs).failure(b, nowMs)
}

func (b *CircuitBreaker) state(nowMs int64) string {
	return b.at(nowMs).name()
}

// The extension round: the manual override.
func (b *CircuitBreaker) forceOpen(on bool) {
	b.current = b.current.force(on)
}

func (b *CircuitBreaker) at(nowMs int64) cbState {
	if nowMs < b.lastMs {
		panic("time went backwards")
	}
	b.lastMs = nowMs
	b.current = b.current.tick(b, nowMs)
	return b.current
}
