package main

// The abstraction the sender depends on. A transport delivers one message and returns its
// receipt, or nil when the send failed; how it delivers is its own business.
type transport interface {
	send(id, payload string) *string
	planFailures(n int64)
}

// What every transport shares: failures planned with failNext come before any delivery.
type failingTransport struct {
	failures int64
	deliver  func(id, payload string) string
}

func (t *failingTransport) send(id, payload string) *string {
	if t.failures > 0 {
		t.failures--
		return nil
	}
	receipt := t.deliver(id, payload)
	return &receipt
}

func (t *failingTransport) planFailures(n int64) { t.failures = n }

var transports = map[string]func(id, payload string) string{
	"http":  func(id, payload string) string { return "POST " + id + " " + payload },
	"queue": func(id, payload string) string { return "PUBLISH " + id + " " + payload },
	"email": func(id, payload string) string { return "MAIL " + id + " " + payload },
}

func transportNamed(name string) transport {
	deliver, ok := transports[name]
	if !ok {
		panic("unknown transport")
	}
	return &failingTransport{deliver: deliver}
}

func outboxGiven(value string) {
	if value == "" {
		panic("empty")
	}
}

type outboxMessage struct {
	id, payload string
	failed      int64
}

// Business code only ever writes to the outbox. Which transport delivers is chosen by
// name from a registry and can be replaced while messages wait, without the outbox changing.
type OutboxSender struct {
	name      string
	transport transport
	queued    []*outboxMessage
	seen      map[string]bool
	limit     *int64
	dead      []string
}

func NewOutboxSender(transport string) *OutboxSender {
	return &OutboxSender{name: transport, transport: transportNamed(transport), seen: map[string]bool{}, dead: []string{}}
}

func (o *OutboxSender) enqueue(id string, payload string) bool {
	outboxGiven(id)
	outboxGiven(payload)
	if o.seen[id] {
		return false
	}
	o.seen[id] = true
	o.queued = append(o.queued, &outboxMessage{id: id, payload: payload})
	return true
}

func (o *OutboxSender) flush() []string {
	receipts := []string{}
	waiting := []*outboxMessage{}
	for _, message := range o.queued {
		receipt := o.transport.send(message.id, message.payload)
		if receipt != nil {
			receipts = append(receipts, *receipt)
			continue
		}
		message.failed++
		if o.limit != nil && message.failed >= *o.limit {
			o.dead = append(o.dead, message.id)
		} else {
			waiting = append(waiting, message)
		}
	}
	o.queued = waiting
	return receipts
}

func (o *OutboxSender) failNext(n int64) {
	if n < 0 {
		panic("negative count")
	}
	o.transport.planFailures(n)
}

func (o *OutboxSender) swapTransport(transport string) {
	if transport == o.name {
		panic("already in use")
	}
	o.transport = transportNamed(transport)
	o.name = transport
}

func (o *OutboxSender) pending() int64 {
	return int64(len(o.queued))
}

// The extension round: a limit on retries, and somewhere for the hopeless to go.
func (o *OutboxSender) maxAttempts(n int64) {
	if n < 1 {
		panic("at least one attempt")
	}
	o.limit = &n
}

func (o *OutboxSender) deadLetters() []string {
	return append([]string{}, o.dead...)
}
