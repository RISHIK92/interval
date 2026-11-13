package main

import (
	"strings"
	"testing"
)

const lruPython = `class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.items = {}
        self.order = []

    def get(self, key):
        if key not in self.items:
            return -1
        self.order.remove(key)
        self.order.append(key)
        return self.items[key]

    def put(self, key, value):
        if key in self.items:
            self.order.remove(key)
        elif len(self.items) >= self.capacity:
            oldest = self.order.pop(0)
            del self.items[oldest]
        self.items[key] = value
        self.order.append(key)
`

// The same code with every name changed and a comment added: still the same code.
const lruRenamed = `class Cache:
    # mine
    def __init__(self, size):
        self.size = size
        self.store = {}
        self.keys = []

    def get(self, k):
        if k not in self.store:
            return -1
        self.keys.remove(k)
        self.keys.append(k)
        return self.store[k]

    def put(self, k, v):
        if k in self.store:
            self.keys.remove(k)
        elif len(self.store) >= self.size:
            first = self.keys.pop(0)
            del self.store[first]
        self.store[k] = v
        self.keys.append(k)
`

// A different design: an ordered dict.
const lruOther = `from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.data = OrderedDict()

    def get(self, key):
        if key not in self.data:
            return -1
        self.data.move_to_end(key)
        return self.data[key]

    def put(self, key, value):
        self.data[key] = value
        self.data.move_to_end(key)
        if len(self.data) > self.capacity:
            self.data.popitem(last=False)
`

func TestRenamingDoesntHideCopiedCode(t *testing.T) {
	if s := similarity(lruPython, lruRenamed); s < similarAt {
		t.Fatalf("renamed copy: %.2f", s)
	}
	if s := similarity(lruPython, lruOther); s >= similarAt {
		t.Fatalf("a different design: %.2f", s)
	}
	if similarity("", lruPython) != 0 {
		t.Fatal("nothing is similar to nothing")
	}
}

// Two players who barely touched the same starter haven't copied each other.
func TestTheStarterIsntCopying(t *testing.T) {
	if s := similarity(lruPython+"\n# a", lruPython+"\n# b", lruPython); s >= similarAt {
		t.Fatalf("both just the starter: %.2f", s)
	}
}

func TestOnlyTheSameLanguagesBestsArePaired(t *testing.T) {
	got := similarPairs(map[string]*codeMsg{
		"ada": {language: "python", code: lruPython},
		"bob": {language: "python", code: lruRenamed},
		"cy":  {language: "go", code: lruPython},
		"dee": {language: "python", code: lruOther},
	})
	if len(got) != 1 || got[0] != [2]string{"ada", "bob"} {
		t.Fatalf("got %v", got)
	}
}

func TestCopiedBestsAreSignalledInTheHumanLeague(t *testing.T) {
	a, clock, store, ada, bob := startBattle(t)
	for _, s := range []struct {
		player string
		seat   *fakeSeat
		code   string
	}{{"ada", ada, lruPython}, {"bob", bob, lruRenamed}} {
		a.post(event{kind: "code", player: s.player, at: clock.Now(), code: &codeMsg{submit: true, language: "python", code: s.code}})
		nextOf(t, s.seat, "submitted")
	}
	settle(a)
	clock.Advance(battleLength)
	nextOf(t, ada, "final")
	resultOf(t, store)
	for _, player := range []string{"ada", "bob"} {
		got := signalsOf(t, store, player)
		if len(got) != 1 || got[0].Kind != "similar" || got[0].Ms != nil || got[0].Chars != nil {
			t.Fatalf("%s: %+v", player, got)
		}
	}
}

// A short skeleton found inside a full solution isn't a copy of it; nor are interleaved
// comments a disguise.
func TestASkeletonInsideAFullSolutionIsntACopy(t *testing.T) {
	skeleton := lruPython[:strings.Index(lruPython, "    def put")]
	if s := similarity(skeleton, lruPython); s >= similarAt {
		t.Fatalf("skeleton: %.2f", s)
	}
	commented := strings.ReplaceAll(lruRenamed, "\n", "  # note\n")
	if s := similarity(lruPython, commented); s < similarAt {
		t.Fatalf("commented copy: %.2f", s)
	}
}
