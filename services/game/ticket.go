package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// A match ticket (ADR-0033, P3-W15-S02), signed by the web app with the shared secret:
// v1.<base64url(JSON claims)>.<base64url(HMAC-SHA256 of the first two parts)>. The game
// server knows players only through these; it never reads the auth database.
type claims struct {
	M string `json:"m"` // match id
	U string `json:"u"` // user id
	S string `json:"s"` // the server that owns the match
	E int64  `json:"e"` // expiry, Unix seconds
	N string `json:"n"` // nonce: each ticket is used once
}

// Longer than any real ticket; checked before any decoding.
const maxTicketBytes = 1024

type ticketError struct{ kind string } // malformed, signature, expired, server

func (e *ticketError) Error() string { return "ticket refused: " + e.kind }

func verify(token string, secret []byte, serverID string, now time.Time) (claims, error) {
	refuse := func(kind string) (claims, error) { return claims{}, &ticketError{kind} }
	if len(token) > maxTicketBytes {
		return refuse("malformed")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return refuse("malformed")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return refuse("malformed")
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return refuse("signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return refuse("malformed")
	}
	var c claims
	if err := json.Unmarshal(payload, &c); err != nil || c.M == "" || c.U == "" || c.S == "" || c.N == "" || c.E <= 0 {
		return refuse("malformed")
	}
	// No allowance for clock skew: both hosts keep NTP time (Fargate, the VM), and a
	// clock behind still keeps the nonce until the same expiry, so replay stays shut.
	if c.E <= now.Unix() {
		return refuse("expired")
	}
	if c.S != serverID {
		return refuse("server")
	}
	return c, nil
}

// Nonces already used, each kept until its ticket would have expired anyway.
// shortcut: in memory, so a ticket used just before a restart could be used again in its
// remaining seconds (60 at most); move to Valkey if tickets ever live longer.
type usedNonces struct {
	mu   sync.Mutex
	seen map[string]int64
}

func newUsedNonces() *usedNonces { return &usedNonces{seen: map[string]int64{}} }

// False when the nonce was used already.
func (u *usedNonces) claim(nonce string, expires int64, now time.Time) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	for n, e := range u.seen {
		if e <= now.Unix() {
			delete(u.seen, n)
		}
	}
	if _, used := u.seen[nonce]; used {
		return false
	}
	u.seen[nonce] = expires
	return true
}

func (u *usedNonces) size() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.seen)
}
