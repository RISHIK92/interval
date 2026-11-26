package main

var beEvents = map[string]bool{"queued": true, "started": true, "passed": true, "failed": true}

func beGiven(value string) {
	if value == "" {
		panic("empty")
	}
}

func beCheckEvent(event string) {
	if !beEvents[event] {
		panic("unknown event")
	}
}

// An observer: it takes delivery of the events it chose. While paused it keeps them
// back, in order, until it's resumed.
type beSubscriber struct {
	name   string
	events map[string]bool
	inbox  []string
	kept   *[]string
}

// Whether the delivery reached the inbox now (not kept back).
func (s *beSubscriber) update(delivery string) bool {
	if s.kept != nil {
		*s.kept = append(*s.kept, delivery)
	} else {
		s.inbox = append(s.inbox, delivery)
	}
	return s.kept == nil
}

// The subject: it updates every subscriber that chose the event, in the order they
// subscribed, and knows nothing else about them.
type BuildEvents struct {
	// In the order of subscription: re-subscribing puts a subscriber at the back.
	subscribers []*beSubscriber
}

func NewBuildEvents() *BuildEvents {
	return &BuildEvents{}
}

func (b *BuildEvents) subscribe(subscriber string, events []string) {
	beGiven(subscriber)
	chosen := map[string]bool{}
	for _, event := range events {
		chosen[event] = true
	}
	if len(events) == 0 || len(chosen) != len(events) {
		panic("no events, or one listed twice")
	}
	for _, event := range events {
		beCheckEvent(event)
	}
	if b.find(subscriber) >= 0 {
		panic("already subscribed")
	}
	b.subscribers = append(b.subscribers, &beSubscriber{name: subscriber, events: chosen})
}

func (b *BuildEvents) unsubscribe(subscriber string) bool {
	beGiven(subscriber)
	at := b.find(subscriber)
	if at < 0 {
		return false
	}
	b.subscribers = append(b.subscribers[:at], b.subscribers[at+1:]...)
	return true
}

func (b *BuildEvents) publish(event string, build string) []string {
	beCheckEvent(event)
	beGiven(build)
	delivered := []string{}
	for _, subscriber := range b.subscribers {
		if !subscriber.events[event] {
			continue
		}
		if subscriber.update(build + " " + event) {
			delivered = append(delivered, subscriber.name)
		}
	}
	return delivered
}

func (b *BuildEvents) inbox(subscriber string) []string {
	return append([]string{}, b.known(subscriber).inbox...)
}

// The extension round: holding deliveries back.
func (b *BuildEvents) pause(subscriber string) {
	found := b.known(subscriber)
	if found.kept != nil {
		panic("already paused")
	}
	found.kept = &[]string{}
}

func (b *BuildEvents) resume(subscriber string) int64 {
	found := b.known(subscriber)
	if found.kept == nil {
		panic("not paused")
	}
	found.inbox = append(found.inbox, *found.kept...)
	delivered := int64(len(*found.kept))
	found.kept = nil
	return delivered
}

func (b *BuildEvents) find(subscriber string) int {
	for at, s := range b.subscribers {
		if s.name == subscriber {
			return at
		}
	}
	return -1
}

func (b *BuildEvents) known(subscriber string) *beSubscriber {
	at := b.find(subscriber)
	if at < 0 {
		panic("not subscribed")
	}
	return b.subscribers[at]
}
