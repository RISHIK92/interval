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
}

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
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.over(id) {
		return nil, errMatchOver
	}
	if a, ok := g.actors[id]; ok { // another player's join made it meanwhile
		return a, nil
	}
	a := newActor(id, def, g.clock, g.log)
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

// A match whose definition is in memory, for tests.
type memStore map[string]matchDef

func (s memStore) load(_ context.Context, id string) (matchDef, error) {
	def, ok := s[id]
	if !ok {
		return matchDef{}, errNoMatch
	}
	return def, nil
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
