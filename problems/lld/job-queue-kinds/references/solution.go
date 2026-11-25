package main

const (
	maxJobPriority = 1_000_000
	maxJobMs       = 1_000_000_000_000
)

type queuedJob struct {
	name      string
	priority  int64
	notBefore int64
	seq       int64
}

// A kind only says which of two ready jobs comes first.
type jobOrder func(a, b queuedJob) bool

// The contract every kind honours lives here, once: only ready jobs leave, size counts
// every job, a job leaves once, and peeking asks the same question polling does. A kind
// only supplies its order, so it can't break any of that.
type jobQueueCore struct {
	jobs  map[string]queuedJob
	first jobOrder
}

func (q *jobQueueCore) peek(now int64) (queuedJob, bool) {
	var found queuedJob
	ok := false
	for _, job := range q.jobs {
		if job.notBefore <= now && (!ok || q.first(job, found)) {
			found, ok = job, true
		}
	}
	return found, ok
}

func (q *jobQueueCore) poll(now int64) (queuedJob, bool) {
	job, ok := q.peek(now)
	if ok {
		delete(q.jobs, job.name)
	}
	return job, ok
}

func (q *jobQueueCore) push(job queuedJob) { q.jobs[job.name] = job }

func (q *jobQueueCore) remove(name string) bool {
	_, ok := q.jobs[name]
	delete(q.jobs, name)
	return ok
}

func (q *jobQueueCore) size() int64 { return int64(len(q.jobs)) }

var jobKinds = map[string]jobOrder{
	"fifo": func(a, b queuedJob) bool { return a.seq < b.seq },
	"priority": func(a, b queuedJob) bool {
		return a.priority > b.priority || a.priority == b.priority && a.seq < b.seq
	},
	"delayed": func(a, b queuedJob) bool {
		return a.notBefore < b.notBefore || a.notBefore == b.notBefore && a.seq < b.seq
	},
}

func jobTime(ms int64) int64 {
	if ms < 0 || ms > maxJobMs {
		panic("a time is 0 to 10^12")
	}
	return ms
}

type JobQueue struct {
	queue *jobQueueCore
	used  map[string]bool
}

func NewJobQueue(kind string) *JobQueue {
	order, ok := jobKinds[kind]
	if !ok {
		panic("an unknown kind")
	}
	return &JobQueue{&jobQueueCore{map[string]queuedJob{}, order}, map[string]bool{}}
}

func (q *JobQueue) push(job string, priority int64, notBeforeMs int64) {
	if job == "" || q.used[job] {
		panic("a job needs a name of its own")
	}
	if priority < 0 || priority > maxJobPriority {
		panic("a priority is 0 to 10^6")
	}
	notBefore := jobTime(notBeforeMs)
	q.queue.push(queuedJob{job, priority, notBefore, int64(len(q.used))})
	q.used[job] = true
}

func (q *JobQueue) poll(nowMs int64) *string {
	job, ok := q.queue.poll(jobTime(nowMs))
	if !ok {
		return nil
	}
	return &job.name
}

func (q *JobQueue) peekAt(nowMs int64) *string {
	job, ok := q.queue.peek(jobTime(nowMs))
	if !ok {
		return nil
	}
	return &job.name
}

func (q *JobQueue) size() int64 {
	return q.queue.size()
}

// The extension round.
func (q *JobQueue) cancel(job string) bool {
	if job == "" {
		panic("an empty job")
	}
	return q.queue.remove(job)
}
