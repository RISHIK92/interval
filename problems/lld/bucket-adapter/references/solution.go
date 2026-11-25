package main

import (
	"sort"
	"strings"
)

// The old flat key-value store: no buckets, no folders, just keys.
type baLegacyStore struct {
	data map[string]string
}

func (s *baLegacyStore) scan(prefix string) []string {
	keys := []string{}
	for key := range s.data {
		if strings.HasPrefix(key, prefix) {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}

func baCheckBucket(bucket string) {
	if bucket == "" || strings.Contains(bucket, ":") {
		panic("bad bucket")
	}
}

func baGiven(value string) {
	if value == "" {
		panic("empty")
	}
}

func baLegacy(bucket, key string) string {
	return bucket + ":" + key
}

// Gives the legacy store a bucket-and-key API. The encoding is the adapter's alone: an
// object lives at `<bucket>:<key>`, and a bucket never holds a `:`, so the first one
// splits them.
type BucketAdapter struct {
	store *baLegacyStore
}

func NewBucketAdapter() *BucketAdapter {
	return &BucketAdapter{store: &baLegacyStore{data: map[string]string{}}}
}

func (a *BucketAdapter) putObject(bucket string, key string, body string) {
	baCheckBucket(bucket)
	baGiven(key)
	baGiven(body)
	a.store.data[baLegacy(bucket, key)] = body
}

func (a *BucketAdapter) objectBody(bucket string, key string) *string {
	baCheckBucket(bucket)
	baGiven(key)
	if body, ok := a.store.data[baLegacy(bucket, key)]; ok {
		return &body
	}
	return nil
}

func (a *BucketAdapter) listObjects(bucket string, prefix string, delimiter string) []string {
	baCheckBucket(bucket)
	found := map[string]bool{}
	for _, stored := range a.store.scan(baLegacy(bucket, prefix)) {
		key := stored[len(bucket)+1:]
		// S3's common prefixes: what follows the prefix, up to its first delimiter.
		if cut := strings.Index(key[len(prefix):], delimiter); delimiter != "" && cut >= 0 {
			key = key[:len(prefix)+cut+len(delimiter)]
		}
		found[key] = true
	}
	keys := []string{}
	for key := range found {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func (a *BucketAdapter) legacyKeys() []string {
	return a.store.scan("")
}

// The extension round: a copy, through the same encoding.
func (a *BucketAdapter) copyObject(bucket string, key string, toBucket string, toKey string) bool {
	baCheckBucket(bucket)
	baGiven(key)
	baCheckBucket(toBucket)
	baGiven(toKey)
	body, ok := a.store.data[baLegacy(bucket, key)]
	if !ok {
		return false
	}
	a.store.data[baLegacy(toBucket, toKey)] = body
	return true
}
