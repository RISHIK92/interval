package main

import (
	"fmt"
	"strings"
)

const (
	keyMaxNow  = 10_000_000_000_000
	keyMaxTTL  = 1_000_000_000_000
	keyGraceMs = 60_000
)

func scopeWord(text string) bool {
	if text == "" {
		return false
	}
	for _, c := range text {
		if c < 'a' || c > 'z' {
			return false
		}
	}
	return true
}

func checkedScope(scope string, wildcard bool) {
	resource, action, _ := strings.Cut(scope, ":")
	if !scopeWord(resource) || !(scopeWord(action) || (wildcard && action == "*")) {
		panic("a scope is resource:action")
	}
}

func grantOf(scopes []string) []string {
	if len(scopes) < 1 || len(scopes) > 20 {
		panic("1 to 20 scopes")
	}
	for _, s := range scopes {
		checkedScope(s, true)
	}
	return append([]string{}, scopes...)
}

func covers(grant []string, scope string) bool {
	resource, _, _ := strings.Cut(scope, ":")
	for _, g := range grant {
		if g == scope || g == resource+":*" {
			return true
		}
	}
	return false
}

type apiKey struct {
	owner            string
	grant            []string
	ttl, expires     int64
	revoked, rotated bool
}

func (k *apiKey) live(now int64) bool {
	return !k.revoked && now < k.expires
}

type ApiKeyStore struct {
	keys map[string]*apiKey
}

func NewApiKeyStore() *ApiKeyStore {
	return &ApiKeyStore{keys: map[string]*apiKey{}}
}

func (s *ApiKeyStore) add(owner string, grant []string, now, ttl int64) string {
	id := fmt.Sprintf("key-%d", len(s.keys)+1)
	s.keys[id] = &apiKey{owner: owner, grant: grant, ttl: ttl, expires: now + ttl}
	return id
}

func (s *ApiKeyStore) issue(owner string, scopes []string, nowMs int64, ttlMs int64) string {
	grant := grantOf(scopes)
	if owner == "" || nowMs < 0 || nowMs > keyMaxNow || ttlMs < 1 || ttlMs > keyMaxTTL {
		panic("an owner, a time and a time to live")
	}
	return s.add(owner, grant, nowMs, ttlMs)
}

func (s *ApiKeyStore) can(keyId string, scope string, nowMs int64) bool {
	checkedScope(scope, false)
	key, ok := s.keys[keyId]
	return ok && key.live(nowMs) && covers(key.grant, scope)
}

func (s *ApiKeyStore) narrow(keyId string, scopes []string) bool {
	grant := grantOf(scopes)
	key, ok := s.keys[keyId]
	if !ok || key.revoked {
		return false
	}
	for _, scope := range grant {
		if !covers(key.grant, scope) {
			return false
		}
	}
	key.grant = grant
	return true
}

func (s *ApiKeyStore) revoke(keyId string) bool {
	key, ok := s.keys[keyId]
	if !ok || key.revoked {
		return false
	}
	key.revoked = true
	return true
}

// The extension round.
func (s *ApiKeyStore) rotate(keyId string, nowMs int64) string {
	key, ok := s.keys[keyId]
	if !ok || key.rotated || nowMs < 0 || nowMs > keyMaxNow || !key.live(nowMs) {
		panic("only a live key is rotated, once")
	}
	key.rotated = true
	key.expires = min(key.expires, nowMs+keyGraceMs)
	return s.add(key.owner, key.grant, nowMs, key.ttl)
}
