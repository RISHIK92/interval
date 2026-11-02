package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// P3-W17-S01 (BOT-1, BOT-3, Q-P3-25): a ghost replays a recorded run. It is seated from
// the start, never joins or leaves, and answers on the match's clock at its recorded
// times, judged by the usual rules.

func withGhost(def matchDef, answers ...ghostAnswer) matchDef {
	def.Players = []string{"ada", "ghost:7"}
	def.Ghost = &ghostDef{Player: "ghost:7", Label: "Ghost · ~1600", Answers: answers}
	return def
}

// One human, Ada, against the ghost; the countdown played for a rounds match.
func startGhost(t *testing.T, def matchDef) (*actor, *fakeClock, *fakeSeat) {
	t.Helper()
	clock := newFakeClock()
	a := newActor("m", def, clock, nil)
	go a.run()
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	if m := ada.next(t); m["type"] != "countdown" {
		t.Fatalf("got %v", m)
	}
	settle(a)
	clock.Advance(countdownTime)
	settle(a)
	return a, clock, ada
}

func TestAGhostTakesARoundAtItsRecordedTime(t *testing.T) {
	a, clock, ada := startGhost(t, withGhost(sevenRounds(), ghostAnswer{N: 1, Choice: 0, Ms: 4000}))
	ada.next(t) // round 1
	clock.Advance(3 * time.Second)
	settle(a)
	select {
	case m := <-ada.out:
		t.Fatalf("the ghost answered early: %v", m)
	default:
	}
	clock.Advance(time.Second)
	settle(a)
	settle(a) // its post, then the actor's handling
	if m := until(t, ada, "reveal"); m["taken"] != "ghost:7" {
		t.Fatalf("got %v", m)
	}
}

func TestAFasterHumanBeatsTheGhost(t *testing.T) {
	a, clock, ada := startGhost(t, withGhost(sevenRounds(), ghostAnswer{N: 1, Choice: 0, Ms: 4000}))
	ada.next(t)
	clock.Advance(2 * time.Second)
	a.answer("ada", 1, 0)
	settle(a)
	if m := until(t, ada, "reveal"); m["taken"] != "ada" {
		t.Fatalf("got %v", m)
	}
}

func TestAGhostPlaysASprintInOrder(t *testing.T) {
	def := withGhost(sprintDef(30),
		ghostAnswer{N: 1, Choice: 0, Ms: 1000},
		ghostAnswer{N: 2, Choice: 3, Ms: 2500}, // wrong
		ghostAnswer{N: 3, Choice: 2, Ms: 4000},
	)
	a, clock, ada := startGhost(t, def)
	until(t, ada, "question")
	for range 4 {
		clock.Advance(time.Second)
		settle(a)
		settle(a)
	}
	score := until(t, ada, "score")
	for score["correct"].(map[string]any)["ghost:7"] != float64(2) {
		score = until(t, ada, "score")
	}
	clock.Advance(sprintTime)
	settle(a)
	final := until(t, ada, "final")
	if final["winner"] != "ghost:7" {
		t.Fatalf("got %v", final)
	}
}

func TestAHumanWhoLeavesAbandonsAndTheGhostStays(t *testing.T) {
	clock := newFakeClock()
	a := newActor("m", withGhost(sevenRounds()), clock, nil)
	go a.run()
	t.Cleanup(a.stop)
	ada := newFakeSeat()
	a.join("ada", ada)
	if m := ada.next(t); m["type"] != "countdown" {
		t.Fatalf("got %v", m)
	}
	// A human who leaves past the grace abandons; the ghost stayed and wins.
	a.leave("ada", ada)
	settle(a)
	clock.Advance(countdownTime)
	settle(a)
	clock.Advance(grace)
	settle(a)
	settle(a)
	select {
	case <-a.ended:
	case <-time.After(2 * time.Second):
		t.Fatal("the match didn't end")
	}
}

func TestParseMatchChecksTheGhost(t *testing.T) {
	good := `{"players":["a","ghost:1"],"rounds":[{"question":1,"stem":"?","options":["x","y"],"correct":0}],"ghost":{"player":"ghost:1","label":"Ghost · ~1500","answers":[{"n":1,"choice":1,"ms":900}]}}`
	if def, err := parseMatch([]byte(good)); err != nil || def.Ghost == nil || def.Ghost.Answers[0].Ms != 900 {
		t.Fatalf("good: %v %v", def, err)
	}
	for name, raw := range map[string]string{
		"not a player":    `{"players":["a","b"],"rounds":[{"question":1,"stem":"?","options":["x","y"],"correct":0}],"ghost":{"player":"ghost:1","label":"G","answers":[]}}`,
		"no label":        `{"players":["a","ghost:1"],"rounds":[{"question":1,"stem":"?","options":["x","y"],"correct":0}],"ghost":{"player":"ghost:1","label":"","answers":[]}}`,
		"no such round":   `{"players":["a","ghost:1"],"rounds":[{"question":1,"stem":"?","options":["x","y"],"correct":0}],"ghost":{"player":"ghost:1","label":"G","answers":[{"n":2,"choice":0,"ms":1}]}}`,
		"a negative time": `{"players":["a","ghost:1"],"rounds":[{"question":1,"stem":"?","options":["x","y"],"correct":0}],"ghost":{"player":"ghost:1","label":"G","answers":[{"n":1,"choice":0,"ms":-1}]}}`,
	} {
		if _, err := parseMatch([]byte(raw)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// Recorded times compensated by a changing round trip needn't rise with the question:
// the sprint ghost still answers every one, in order.
func TestASprintGhostAnswersInOrderWhateverItsTimes(t *testing.T) {
	def := withGhost(sprintDef(30),
		ghostAnswer{N: 1, Choice: 0, Ms: 2000},
		ghostAnswer{N: 2, Choice: 1, Ms: 1900}, // sooner than question 1's
		ghostAnswer{N: 3, Choice: 2, Ms: 1900}, // at the same time
		ghostAnswer{N: 4, Choice: 3, Ms: 3000},
	)
	a, clock, ada := startGhost(t, def)
	until(t, ada, "question")
	for range 4 {
		clock.Advance(time.Second)
		settle(a)
		settle(a)
	}
	score := until(t, ada, "score")
	for score["correct"].(map[string]any)["ghost:7"] != float64(4) {
		score = until(t, ada, "score")
	}
}

// After a restart a ghost is always "back": with its person gone, the match is void.
func TestARestartWithItsPersonGoneIsVoid(t *testing.T) {
	store := newMemStore(map[string]matchDef{"m": withGhost(sevenRounds())})
	_ = store.save(context.Background(), "m", snap{Next: 3})
	clock := newFakeClock()
	g := newRegistry(store, clock, slog.New(slog.DiscardHandler))
	a, err := g.get(context.Background(), "m")
	if err != nil {
		t.Fatal(err)
	}
	settle(a)
	clock.Advance(joinWait)
	waitEnded(t, a)
	results := store.results()
	if len(results) != 1 || results[0].Outcome != "void" {
		t.Fatalf("got %+v", results)
	}
}

// BOT-3: the socket's first message names the ghost by its label.
func TestJoiningAGhostMatchNamesTheGhost(t *testing.T) {
	f := loadFixtures(t)
	def := withGhost(sevenRounds())
	def.Players = []string{f.Claims.U, "ghost:7"}
	matches := newRegistry(newMemStore(map[string]matchDef{f.Claims.M: def}), realClock{}, slog.New(slog.DiscardHandler))
	t.Cleanup(matches.stopAll)
	cfg := config{serverID: f.Server, ticketSecret: []byte(f.Secret)}
	srv := httptest.NewServer(newHandler(cfg, newMatchSockets(), matches, func() time.Time { return time.Unix(f.Now, 0) }))
	t.Cleanup(srv.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, socketURL(srv, "0", f.Valid), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var joined map[string]string
	_ = json.Unmarshal(data, &joined)
	if joined["type"] != "joined" || joined["opponent"] != "Ghost · ~1600" {
		t.Fatalf("got %v", joined)
	}
}
