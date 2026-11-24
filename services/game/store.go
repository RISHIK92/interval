package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"interval/services/game/judge"
)

// Where the web app leaves a match for its server (Q-P3-22): game:match:<id> in Valkey,
// JSON. Go never reads Postgres (ADR-0033).
type matchStore interface {
	load(ctx context.Context, id string) (matchDef, error)
	// P3-W15-S04: where the match stood after its last round, if it was saved.
	snapshot(ctx context.Context, id string) (snap, bool, error)
	save(ctx context.Context, id string, s snap) error
	// P3-W15-S05: the match's result for the Python worker: kept at game:result:<id>,
	// its id pushed onto game:results.
	publish(ctx context.Context, id string, raw []byte) error
	// ADR-0048: a practice Submit's progress for the worker, pushed onto game:practice.
	publishPractice(ctx context.Context, raw []byte) error
	practiceLimits
}

// ADR-0048 (Q-WD-28): a practice player's daily caps, kept in Valkey. takePractice counts
// one Run or Submit on the UTC day of `at`, or counts nothing and returns the refusal's
// stable code when a cap is reached.
type practiceLimits interface {
	takePractice(ctx context.Context, user, problem string, submit bool, at time.Time) (string, error)
}

const (
	practiceSubmitsPerDay     = 50
	practiceSubmitsPerProblem = 20
	practiceRunsPerDay        = 400
	// Past the day's end in every time zone, then gone.
	practiceCountTTL = 48 * time.Hour
)

// The counters one Run or Submit spends, each with its cap and the code that refuses it.
type practiceCounter struct {
	key  string
	cap  int
	code string
}

func practiceCounters(user, problem string, submit bool, at time.Time) []practiceCounter {
	day := at.UTC().Format(time.DateOnly)
	if !submit {
		return []practiceCounter{{"practice:runs:" + user + ":" + day, practiceRunsPerDay, "daily_runs"}}
	}
	return []practiceCounter{
		{"practice:subs:" + user + ":" + day, practiceSubmitsPerDay, "daily_submits"},
		{"practice:psubs:" + user + ":" + problem + ":" + day, practiceSubmitsPerProblem, "daily_problem_submits"},
	}
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

// The pauses between the tries of a write that must not be lost (the result, "over").
var retryAfter = []time.Duration{200 * time.Millisecond, time.Second}

// A day: long enough for a worker that was down to catch up.
const resultTTL = 24 * time.Hour

func (s redisStore) publish(ctx context.Context, id string, raw []byte) error {
	// Both or neither: an id without its result, or a result nobody is told of, is lost.
	_, err := s.client.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		// First wins: a later "void" (a restart after a lost "over") can't overwrite a
		// result the worker hasn't read yet; the worker records only the first anyway.
		pipe.SetNX(ctx, "game:result:"+id, raw, resultTTL)
		pipe.LPush(ctx, "game:results", id)
		return nil
	})
	return err
}

func (s redisStore) publishPractice(ctx context.Context, raw []byte) error {
	return s.client.LPush(ctx, "game:practice", raw).Err()
}

// Checks every cap before counting any, in one step, so a refusal spends nothing and two
// sockets can't both take the last one.
var takeScript = redis.NewScript(`
for i, key in ipairs(KEYS) do
  if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[i + 1]) then return i end
end
for _, key in ipairs(KEYS) do
  redis.call('INCR', key)
  redis.call('EXPIRE', key, ARGV[1])
end
return 0
`)

func (s redisStore) takePractice(ctx context.Context, user, problem string, submit bool, at time.Time) (string, error) {
	counters := practiceCounters(user, problem, submit, at)
	keys := make([]string, 0, len(counters))
	args := []any{int(practiceCountTTL / time.Second)}
	for _, c := range counters {
		keys = append(keys, c.key)
		args = append(args, c.cap)
	}
	refused, err := takeScript.Run(ctx, s.client, keys, args...).Int()
	if err != nil {
		return "", fmt.Errorf("practice limits: %w", err)
	}
	if refused > 0 && refused <= len(counters) {
		return counters[refused-1].code, nil
	}
	return "", nil
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
	if def.Mode != "" && def.Mode != "fastest_finger" && def.Mode != sprintMode && def.Mode != battleMode {
		return matchDef{}, fmt.Errorf("no such mode: %q", def.Mode)
	}
	if (def.Mode == battleMode) != (def.Battle != nil) {
		return matchDef{}, errors.New("a battle, and only a battle, carries its problem")
	}
	if def.Battle != nil {
		if len(def.Rounds) > 0 || def.Ghost != nil {
			return matchDef{}, errors.New("a battle has no quiz rounds or ghost")
		}
		if err := def.Battle.validate(); err != nil {
			return matchDef{}, err
		}
	} else if len(def.Rounds) == 0 {
		return matchDef{}, errors.New("a match needs players and rounds")
	}
	if len(def.Players) == 0 {
		return matchDef{}, errors.New("a match needs players and rounds")
	}
	// C-03: a battle is a 1v1 or a room of up to 4 (P5-W32).
	if def.Battle != nil && len(def.Players) > maxBattlePlayers {
		return matchDef{}, errors.New("a battle has at most 4 players")
	}
	// ADR-0048: practice is one player's, and never the AI mode.
	if def.Battle != nil && def.Battle.Practice && (len(def.Players) != 1 || def.Battle.Mode == "ai") {
		return matchDef{}, errors.New("a practice battle is one player's, in the human mode")
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
	if g := def.Ghost; g != nil {
		if g.Label == "" || !seen[g.Player] {
			return matchDef{}, errors.New("a ghost must be a labeled player")
		}
		for _, answer := range g.Answers {
			if answer.N < 1 || answer.N > len(def.Rounds) || answer.Ms < 0 ||
				answer.Choice < 0 || answer.Choice >= len(def.Rounds[answer.N-1].Options) {
				return matchDef{}, errors.New("a ghost answer to no round")
			}
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
	// P5-W31-S02b-2: battles' judge (Velox, VELOX_URL); without one, battles are refused.
	judge judge.Judge
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

// Without VELOX_URL a server can't judge code, so it serves no battles.
var errBattleNotServed = errors.New("no judge for battles: VELOX_URL is not set")

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
	if def.Battle != nil && g.judge == nil {
		return nil, errBattleNotServed
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
	if found && ((saved.Next >= 1 && saved.Next <= len(def.Rounds)) || !saved.Started.IsZero()) {
		a.from = &saved
	}
	a.judge = g.judge
	a.save = func(s snap) {
		// LOAD-5: the match plays on and only loses its restart point (a metric in the
		// AWS stack counts these). The last one, "over", is tried three times: lost, a
		// restart could play a finished match again from its last round. So is each of a
		// practice session's (ADR-0048): lost, a restart would send its progress sequence
		// number again, and the worker would drop that Submit as a repeat. And the one
		// that records a hint level (Q-WD-17): lost, a restart would refund it.
		tries := 1
		if s.Over || s.Retry || (def.Battle != nil && def.Battle.Practice) {
			tries = len(retryAfter) + 1
		}
		for try := 1; try <= tries; try++ {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err := g.store.save(ctx, id, s)
			cancel()
			if err == nil {
				return
			}
			g.log.Error("game: snapshot failed", "match", id, "over", s.Over, "try", try, "error", err.Error())
			if try < tries {
				time.Sleep(retryAfter[try-1])
			}
		}
	}
	a.publish = func(r result) {
		// Three tries, then said and counted (LOAD-5): the match's result is lost to the
		// worker. The worker takes a result once, so a repeat is harmless.
		raw, err := json.Marshal(r)
		if err != nil {
			g.log.Error("game: result not handed over", "match", id, "error", err.Error())
			return
		}
		for try := 1; try <= len(retryAfter)+1; try++ {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err = g.store.publish(ctx, id, raw)
			cancel()
			if err == nil {
				return
			}
			g.log.Error("game: result not handed over", "match", id, "try", try, "error", err.Error())
			if try <= len(retryAfter) {
				time.Sleep(retryAfter[try-1]) // a blip of Valkey shouldn't lose the result
			}
		}
	}
	a.limits = g.store
	a.progress = func(pj practiceJudged) {
		// Off the actor, so a Valkey blip doesn't hold up play. Order doesn't matter: the
		// worker counts each sequence number once and keeps the most points, whatever
		// order they arrive in. As a result: three tries, then said and counted (LOAD-5,
		// the AWS stack's GamePracticeHandoffFailures metric); that Submit is lost to the
		// worker, and the next one still counts.
		raw, err := json.Marshal(pj)
		if err != nil {
			g.log.Error("game: practice progress not handed over", "match", id, "error", err.Error())
			return
		}
		go func() {
			for try := 1; try <= len(retryAfter)+1; try++ {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				err := g.store.publishPractice(ctx, raw)
				cancel()
				if err == nil {
					return
				}
				g.log.Error("game: practice progress not handed over", "match", id, "seq", pj.Seq, "try", try, "error", err.Error())
				if try <= len(retryAfter) {
					time.Sleep(retryAfter[try-1])
				}
			}
		}()
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
	mu       sync.Mutex
	defs     map[string]matchDef
	snaps    map[string]snap
	fail     bool // every save fails
	pushed   [][]byte
	failPush bool // every publish fails
	// ADR-0048: practice progress pushed, and the daily counters.
	practice     [][]byte
	counts       map[string]int
	failLimits   bool // every takePractice fails
	failPractice bool // every publishPractice fails
}

func (s *memStore) publishPractice(_ context.Context, raw []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failPractice {
		return errors.New("store down")
	}
	s.practice = append(s.practice, raw)
	return nil
}

// The practice progress published so far, decoded.
func (s *memStore) progress() []practiceJudged {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]practiceJudged, 0, len(s.practice))
	for _, raw := range s.practice {
		var p practiceJudged
		if err := json.Unmarshal(raw, &p); err != nil {
			panic("a published progress message isn't JSON: " + err.Error()) // tests only
		}
		out = append(out, p)
	}
	return out
}

func (s *memStore) takePractice(_ context.Context, user, problem string, submit bool, at time.Time) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failLimits {
		return "", errors.New("store down")
	}
	counters := practiceCounters(user, problem, submit, at)
	for _, c := range counters {
		if s.counts[c.key] >= c.cap {
			return c.code, nil
		}
	}
	for _, c := range counters {
		s.counts[c.key]++
	}
	return "", nil
}

func (s *memStore) publish(_ context.Context, _ string, raw []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failPush {
		return errors.New("store down")
	}
	s.pushed = append(s.pushed, raw)
	return nil
}

// The results published so far, decoded.
func (s *memStore) results() []result {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]result, 0, len(s.pushed))
	for _, raw := range s.pushed {
		var r result
		if err := json.Unmarshal(raw, &r); err != nil {
			panic("a published result isn't JSON: " + err.Error()) // tests only
		}
		out = append(out, r)
	}
	return out
}

func newMemStore(defs map[string]matchDef) *memStore {
	return &memStore{defs: defs, snaps: map[string]snap{}, counts: map[string]int{}}
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
	copied := snap{Next: saved.Next, Over: saved.Over, Retry: saved.Retry, Started: saved.Started, Seq: saved.Seq, Revealed: saved.Revealed, Totals: map[string]int{}, Times: map[string]time.Duration{}}
	for k, v := range saved.Totals {
		copied.Totals[k] = v
	}
	for k, v := range saved.Times {
		copied.Times[k] = v
	}
	copied.Signals = map[string][]fairPlaySignal{}
	for k, v := range saved.Signals {
		copied.Signals[k] = slices.Clone(v)
	}
	copied.Answers = map[string][]answerRec{}
	for k, v := range saved.Answers {
		copied.Answers[k] = slices.Clone(v)
	}
	copied.Passed = maps.Clone(saved.Passed)
	copied.Hints = map[string][]int{}
	for k, v := range saved.Hints {
		copied.Hints[k] = slices.Clone(v)
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
