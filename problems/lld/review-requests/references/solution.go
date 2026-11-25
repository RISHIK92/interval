package main

import "strings"

type pullRequest struct {
	author    string
	requested map[string]bool
	approved  map[string]bool
}

type codeOwner struct{ prefix, reviewer string }

// Pull requests and people are associated, never owned: a pull request holds the names
// of its author and reviewers, and each reviewer's queue holds pull request ids.
type ReviewQueue struct {
	prs     map[string]*pullRequest
	pending map[string][]string
	owners  []codeOwner
}

func NewReviewQueue() *ReviewQueue {
	return &ReviewQueue{prs: map[string]*pullRequest{}, pending: map[string][]string{}}
}

func reviewNamed(names ...string) {
	for _, n := range names {
		if n == "" {
			panic("ids and names are not empty")
		}
	}
}

func (q *ReviewQueue) get(pr string) *pullRequest {
	found, ok := q.prs[pr]
	if !ok {
		panic("unknown pull request")
	}
	return found
}

func (q *ReviewQueue) open(pr string, author string) {
	reviewNamed(pr, author)
	if _, ok := q.prs[pr]; ok {
		panic("pull request already opened")
	}
	q.prs[pr] = &pullRequest{author: author, requested: map[string]bool{}, approved: map[string]bool{}}
}

func (q *ReviewQueue) request(pr string, reviewer string) bool {
	reviewNamed(pr, reviewer)
	found := q.get(pr)
	if reviewer == found.author || found.requested[reviewer] {
		return false
	}
	found.requested[reviewer] = true
	q.pending[reviewer] = append(q.pending[reviewer], pr)
	return true
}

func (q *ReviewQueue) approve(pr string, reviewer string) bool {
	reviewNamed(pr, reviewer)
	found := q.get(pr)
	if !found.requested[reviewer] || found.approved[reviewer] {
		return false
	}
	found.approved[reviewer] = true
	queue := q.pending[reviewer]
	for i, p := range queue {
		if p == pr {
			q.pending[reviewer] = append(queue[:i:i], queue[i+1:]...)
			break
		}
	}
	return true
}

func (q *ReviewQueue) pendingFor(reviewer string) []string {
	reviewNamed(reviewer)
	return append([]string{}, q.pending[reviewer]...)
}

func (q *ReviewQueue) approvals(pr string) int64 {
	reviewNamed(pr)
	return int64(len(q.get(pr).approved))
}

// The extension round: owners of a path prefix are requested when it's touched.
func (q *ReviewQueue) codeowner(pathPrefix string, reviewer string) {
	reviewNamed(pathPrefix, reviewer)
	owner := codeOwner{pathPrefix, reviewer}
	for _, o := range q.owners {
		if o == owner {
			return
		}
	}
	q.owners = append(q.owners, owner)
}

func (q *ReviewQueue) touch(pr string, path string) int64 {
	reviewNamed(pr, path)
	q.get(pr)
	var added int64
	for _, o := range q.owners {
		if strings.HasPrefix(path, o.prefix) && q.request(pr, o.reviewer) {
			added++
		}
	}
	return added
}
