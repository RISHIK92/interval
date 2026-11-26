package main

import "strconv"

const advanceBelow = 1.0
const abortAbove = 5.0
const maxRate = 100.0

// One state of the rollout. Each move returns the next state, or nil when this state
// doesn't allow it, so every state lists only its own moves.
type rolloutState interface {
	name() string
	percent() int64
	begin() rolloutState
	advance() rolloutState
	pause() rolloutState
	resume() rolloutState
	abort() rolloutState
}

// Allows nothing; each state embeds it and overrides only its own moves.
type still struct {
	label string
	share int64
}

func (s *still) name() string          { return s.label }
func (s *still) percent() int64        { return s.share }
func (s *still) begin() rolloutState   { return nil }
func (s *still) advance() rolloutState { return nil }
func (s *still) pause() rolloutState   { return nil }
func (s *still) resume() rolloutState  { return nil }
func (s *still) abort() rolloutState   { return nil }

type pausedState struct {
	still
	was rolloutState
}

func (s *pausedState) resume() rolloutState { return s.was }

// Canary and rolling share their moves: on, pause and abort.
type movingState struct {
	still
	after rolloutState
}

func (s *movingState) advance() rolloutState { return s.after }
func (s *movingState) pause() rolloutState {
	return &pausedState{still{"paused", s.share}, s}
}
func (s *movingState) abort() rolloutState { return &still{"rolled-back", 0} }

type pendingState struct{ still }

func (s *pendingState) begin() rolloutState {
	return &movingState{still{"canary", 10}, &movingState{still{"rolling", 50}, &still{"done", 100}}}
}

type Rollout struct {
	service, version string
	state            rolloutState
}

func NewRollout(service string) *Rollout {
	if service == "" {
		panic("an empty service")
	}
	return &Rollout{service: service, state: &pendingState{still{"pending", 0}}}
}

func (r *Rollout) move(to rolloutState) bool {
	if to == nil {
		return false
	}
	r.state = to
	return true
}

func (r *Rollout) begin(version string) bool {
	if version == "" {
		panic("an empty version")
	}
	to := r.state.begin()
	if to != nil {
		r.version = version
	}
	return r.move(to)
}

func (r *Rollout) advance() bool { return r.move(r.state.advance()) }
func (r *Rollout) pause() bool   { return r.move(r.state.pause()) }
func (r *Rollout) resume() bool  { return r.move(r.state.resume()) }
func (r *Rollout) abort() bool   { return r.move(r.state.abort()) }

func (r *Rollout) status() string {
	if r.version == "" {
		return r.service + " " + r.state.name()
	}
	return r.service + " " + r.state.name() + " " + r.version + " " + strconv.FormatInt(r.state.percent(), 10) + "%"
}

// The extension round: the error rate decides the move.
func (r *Rollout) autoAdvance(errorRate float64) bool {
	if errorRate < 0 || errorRate > maxRate {
		panic("an error rate from 0 to 100")
	}
	if errorRate < advanceBelow {
		return r.advance()
	}
	if errorRate > abortAbove {
		return r.abort()
	}
	return false
}
