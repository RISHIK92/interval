package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Where the web app leaves a match for its server (Q-P3-22): game:match:<id> in Valkey,
// JSON. Go never reads Postgres (ADR-0033).
type matchStore interface {
	load(ctx context.Context, id string) (matchDef, error)
	// P3-W15-S04: where the match stood after its last round, if it was saved.
	snapshot(ctx context.Context, id string) (snap, bool, error)
	save(ctx context.Context, id string, s snap) error
}

// As long as the match itself is kept (the web app's hour).
const snapshotTTL = time.Hour

var (
	errNoMatch   = errors.New("no such match")
	errMatchOver = errors.New("the match is over")
)

// A match that ended stays ended while its definition could still be loaded (the web
// app's hour), so a ticket can't start it again.
const endedFor = time.Hour

type redisStore struct{ client *redis.Client }

func (s redisStore) load(ctx context.Context, id string) (matchDef, error) {
	raw, err := s.client.Get(ctx, "game:match:"+id).Bytes()
	if errors.Is(err, redis.Nil) {
		return matchDef{}, errNoMatch
	}
	if err != nil {
		return matchDef{}, fmt.Errorf("load match %s: %w", id, err)
	}
	return parseMatch(raw)
}

func (s redisStore) snapshot(ctx context.Context, id string) (snap, bool, error) {
	raw, err := s.client.Get(ctx, "game:snap:"+id).Bytes()
	if errors.Is(err, redis.Nil) {
		return snap{}, false, nil
	}
	if err != nil {
		return snap{}, false, fmt.Errorf("load snapshot %s: %w", id, err)
	}
	var saved snap
	if err := json.Unmarshal(raw, &saved); err != nil {
		return snap{}, false, fmt.Errorf("snapshot %s: %w", id, err)
	}
	return saved, true, nil
}

func (s redisStore) save(ctx context.Context, id string, saved snap) error {
	raw, err := json.Marshal(saved)
	if err != nil {
		return err
	}
	return s.client.Set(ctx, "game:snap:"+id, raw, snapshotTTL).Err()
}

// A match as the web app writes it (apps/web/src/server/adapters/valkey-match-handoff.ts):
// distinct players, and rounds whose key is one of their options.
func parseMatch(raw []byte) (matchDef, error) {
	var def matchDef
	if err := json.Unmarshal(raw, &def); err != nil {
		return matchDef{}, fmt.Errorf("not a match: %w", err)
	}
	if len(def.Players) == 0 || len(def.Rounds) == 0 {
		return matchDef{}, errors.New("a match needs players and rounds")
	}
	seen := map[string]bool{}
	for _, p := range def.Players {
		if p == "" || seen[p] {
			return matchDef{}, errors.New("a match's players must be distinct")
		}
		seen[p] = true
	}
	for _, r := range def.Rounds {
		if len(r.Options) < 2 || r.Correct < 0 || r.Correct >= len(r.Options) {
			return matchDef{}, errors.New("a round without its key")
		}
	}
	return def, nil
}

// The matches this server is playing: one actor each, made on its first join and
// forgotten when it ends.
type registry struct {
	mu     sync.Mutex
	actors map[string]*actor
	ended  map[string]time.Time
	store  matchStore
	clock  clock
	log    *slog.Logger
}

func newRegistry(store matchStore, c clock, log *slog.Logger) *registry {
	return &registry{actors: map[string]*actor{}, ended: map[string]time.Time{}, store: store, clock: c, log: log}
}

// Under mu: whether the match has ended, forgetting endings older than endedFor.
func (g *registry) over(id string) bool {
	now := g.clock.Now()
	for ended, at := range g.ended {
		if now.Sub(at) > endedFor {
			delete(g.ended, ended)
		}
	}
	_, over := g.ended[id]
	return over
}

func (g *registry) get(ctx context.Context, id string) (*actor, error) {
	g.mu.Lock()
	if g.over(id) {
		g.mu.Unlock()
		return nil, errMatchOver
	}
	if a, ok := g.actors[id]; ok {
		g.mu.Unlock()
		return a, nil
	}
	g.mu.Unlock()
	def, err := g.store.load(ctx, id)
	if err != nil {
		return nil, err
	}
	saved, found, err := g.store.snapshot(ctx, id)
	if err != nil {
		return nil, err
	}
	if found && saved.Over {
		return nil, errMatchOver // ended before this server last restarted
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.over(id) {
		return nil, errMatchOver
	}
	if a, ok := g.actors[id]; ok { // another player's join made it meanwhile
		return a, nil
	}
	a := newActor(id, def, g.clock, g.log)
	if found && saved.Next >= 1 && saved.Next <= len(def.Rounds) {
		a.from = &saved
	}
	a.save = func(s snap) {
		// LOAD-5: the match plays on and only loses its restart point (a metric in the
		// AWS stack counts these). The last one, "over", is tried three times: lost, a
		// restart could play a finished match again from its last round.
		tries := 1
		if s.Over {
			tries = 3
		}
		for try := 1; try <= tries; try++ {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err := g.store.save(ctx, id, s)
			cancel()
			if err == nil {
				return
			}
			g.log.Error("game: snapshot failed", "match", id, "over", s.Over, "try", try, "error", err.Error())
		}
	}
	g.actors[id] = a
	go a.run() // recovers its own panics
	go func() {
		<-a.ended
		g.mu.Lock()
		delete(g.actors, id)
		g.ended[id] = g.clock.Now()
		g.mu.Unlock()
	}()
	return a, nil
}

func (g *registry) stopAll() {
	g.mu.Lock()
	running := make([]*actor, 0, len(g.actors))
	for _, a := range g.actors {
		running = append(running, a)
	}
	g.mu.Unlock()
	for _, a := range running {
		a.stop()
	}
}

// Matches and snapshots in memory, for tests.
type memStore struct {
	mu    sync.Mutex
	defs  map[string]matchDef
	snaps map[string]snap
	fail  bool // every save fails
}

func newMemStore(defs map[string]matchDef) *memStore {
	return &memStore{defs: defs, snaps: map[string]snap{}}
}

func (s *memStore) load(_ context.Context, id string) (matchDef, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	def, ok := s.defs[id]
	if !ok {
		return matchDef{}, errNoMatch
	}
	return def, nil
}

func (s *memStore) snapshot(_ context.Context, id string) (snap, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	saved, ok := s.snaps[id]
	return saved, ok, nil
}

func (s *memStore) save(_ context.Context, id string, saved snap) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail {
		return errors.New("store down")
	}
	// A copy: the actor goes on changing its maps.
	copied := snap{Next: saved.Next, Over: saved.Over, Totals: map[string]int{}, Times: map[string]time.Duration{}}
	for k, v := range saved.Totals {
		copied.Totals[k] = v
	}
	for k, v := range saved.Times {
		copied.Times[k] = v
	}
	s.snaps[id] = copied
	return nil
}

// Runs fn, ending its goroutine on a panic with a log line instead of the whole server
// (no panics in request paths): one player's connection, never every match.
func safely(log *slog.Logger, what string, fn func()) {
	defer func() {
		if r := recover(); r != nil {
			log.Error("game: recovered", "in", what, "panic", fmt.Sprint(r))
		}
	}()
	fn()
}
