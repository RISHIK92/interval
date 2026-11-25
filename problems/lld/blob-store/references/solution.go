package main

import (
	"sort"
	"strings"
)

// What the store needs from where blobs are kept. Callers only see BlobStore, so which
// backend is behind it never shows in their code.
type backend interface {
	put(key, data string) int64
	latest(key string) *string
	version(key string, version int64) *string
	remove(key string) bool
	keys() []string
}

type plainBlob struct {
	number int64
	data   string
}

// Keeps only the latest blob of each key, and counts the puts to number it.
type plainBackend struct{ blobs map[string]plainBlob }

func (p *plainBackend) put(key, data string) int64 {
	number := p.blobs[key].number + 1
	p.blobs[key] = plainBlob{number, data}
	return number
}

func (p *plainBackend) latest(key string) *string {
	found, ok := p.blobs[key]
	if !ok {
		return nil
	}
	return &found.data
}

func (p *plainBackend) version(key string, version int64) *string {
	found, ok := p.blobs[key]
	if !ok || found.number != version {
		return nil
	}
	return &found.data
}

func (p *plainBackend) remove(key string) bool {
	_, ok := p.blobs[key]
	delete(p.blobs, key)
	return ok
}

func (p *plainBackend) keys() []string {
	out := []string{}
	for k := range p.blobs {
		out = append(out, k)
	}
	return out
}

// Keeps every blob each key has had, oldest first.
type versionedBackend struct{ history map[string][]string }

func (v *versionedBackend) put(key, data string) int64 {
	v.history[key] = append(v.history[key], data)
	return int64(len(v.history[key]))
}

func (v *versionedBackend) latest(key string) *string {
	found, ok := v.history[key]
	if !ok {
		return nil
	}
	return &found[len(found)-1]
}

func (v *versionedBackend) version(key string, version int64) *string {
	found := v.history[key]
	if version > int64(len(found)) {
		return nil
	}
	return &found[version-1]
}

func (v *versionedBackend) remove(key string) bool {
	_, ok := v.history[key]
	delete(v.history, key)
	return ok
}

func (v *versionedBackend) keys() []string {
	out := []string{}
	for k := range v.history {
		out = append(out, k)
	}
	return out
}

func openBackend(kind string) backend {
	switch kind {
	case "plain":
		return &plainBackend{map[string]plainBlob{}}
	case "versioned":
		return &versionedBackend{map[string][]string{}}
	}
	panic("unknown backend")
}

func blobKey(key string) {
	if key == "" {
		panic("keys are not empty")
	}
}

type BlobStore struct {
	kind    string
	backend backend
}

func NewBlobStore(backend string) *BlobStore {
	return &BlobStore{kind: backend, backend: openBackend(backend)}
}

func (s *BlobStore) putBlob(key string, data string) int64 {
	blobKey(key)
	return s.backend.put(key, data)
}

func (s *BlobStore) fetch(key string) *string {
	blobKey(key)
	return s.backend.latest(key)
}

func (s *BlobStore) remove(key string) bool {
	blobKey(key)
	return s.backend.remove(key)
}

func (s *BlobStore) listKeys(prefix string) []string {
	out := []string{}
	for _, k := range s.backend.keys() {
		if strings.HasPrefix(k, prefix) {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func (s *BlobStore) migrate(backend string) int64 {
	if backend == s.kind {
		panic("already on that backend")
	}
	target := openBackend(backend)
	keys := s.backend.keys()
	for _, key := range keys {
		target.put(key, *s.backend.latest(key))
	}
	s.kind = backend
	s.backend = target
	return int64(len(keys))
}

// The extension round: one more question for every backend, answered its own way.
func (s *BlobStore) fetchVersion(key string, version int64) *string {
	blobKey(key)
	if version < 1 {
		panic("versions start at 1")
	}
	return s.backend.version(key, version)
}
