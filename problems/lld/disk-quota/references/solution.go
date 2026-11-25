package main

import "sort"

type DiskQuota struct {
	limit int64
	total int64
	// Only owners holding more than 0 bytes.
	held map[string]int64
	soft *int64
}

func NewDiskQuota(limitBytes int64) *DiskQuota {
	if limitBytes < 0 {
		panic("the limit can't be negative")
	}
	return &DiskQuota{limit: limitBytes, held: map[string]int64{}}
}

func (q *DiskQuota) reserve(owner string, bytes int64) bool {
	if bytes < 1 {
		panic("reserve at least one byte")
	}
	if bytes > q.limit-q.total {
		return false
	}
	q.held[owner] += bytes
	q.total += bytes
	return true
}

func (q *DiskQuota) release(owner string, bytes int64) {
	if bytes < 1 {
		panic("release at least one byte")
	}
	has := q.held[owner]
	if bytes > has {
		panic("more than the owner holds")
	}
	if has == bytes {
		delete(q.held, owner)
	} else {
		q.held[owner] = has - bytes
	}
	q.total -= bytes
}

func (q *DiskQuota) used(owner string) int64 {
	return q.held[owner]
}

func (q *DiskQuota) free() int64 {
	return q.limit - q.total
}

// The extension round.
func (q *DiskQuota) softLimit(bytes int64) {
	if bytes < 0 {
		panic("the soft limit can't be negative")
	}
	q.soft = &bytes
}

func (q *DiskQuota) warnings() []string {
	out := []string{}
	if q.soft == nil {
		return out
	}
	for owner, has := range q.held {
		if has > *q.soft {
			out = append(out, owner)
		}
	}
	sort.Strings(out)
	return out
}
