package main

import (
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"
)

// P3-W15-S02 (ADR-0033): the web app's tickets, checked here against the fixtures both
// sides test with (testdata/tickets.json).
type fixtures struct {
	Secret  string `json:"secret"`
	Now     int64  `json:"now"`
	Server  string `json:"server"`
	Valid   string `json:"valid"`
	Claims  claims `json:"claims"`
	Refused []struct {
		Why    string `json:"why"`
		Ticket string `json:"ticket"`
		Kind   string `json:"kind"`
	} `json:"refused"`
}

func loadFixtures(t *testing.T) fixtures {
	t.Helper()
	raw, err := os.ReadFile("testdata/tickets.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestTicketValid(t *testing.T) {
	f := loadFixtures(t)
	got, err := verify(f.Valid, []byte(f.Secret), f.Server, time.Unix(f.Now, 0))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got != f.Claims {
		t.Fatalf("claims %+v, want %+v", got, f.Claims)
	}
}

func TestTicketRefused(t *testing.T) {
	f := loadFixtures(t)
	for _, tc := range f.Refused {
		_, err := verify(tc.Ticket, []byte(f.Secret), f.Server, time.Unix(f.Now, 0))
		var refused *ticketError
		if !errors.As(err, &refused) || refused.kind != tc.Kind {
			t.Errorf("%s: got %v, want %s", tc.Why, err, tc.Kind)
		}
	}
	long := make([]byte, maxTicketBytes+1)
	if _, err := verify(string(long), []byte(f.Secret), f.Server, time.Unix(f.Now, 0)); err == nil {
		t.Error("an oversized ticket was accepted")
	}
}

func TestNonceSingleUse(t *testing.T) {
	used := newUsedNonces()
	now := time.Unix(1000, 0)
	if !used.claim("a", 1060, now) {
		t.Fatal("first use refused")
	}
	if used.claim("a", 1060, now.Add(30*time.Second)) {
		t.Fatal("second use accepted")
	}
	if !used.claim("b", 1060, now) {
		t.Fatal("another nonce refused")
	}
	// Once its ticket has expired, its nonce is forgotten (the expiry refuses it anyway).
	used.claim("c", 2000, now.Add(61*time.Second))
	if used.size() != 1 {
		t.Fatalf("%d nonces kept after expiry, want 1", used.size())
	}
}
