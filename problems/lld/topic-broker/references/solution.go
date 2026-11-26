package main

import (
	"slices"
	"strconv"
)

const (
	maxPoll  = 100
	maxNacks = 3
	inFlight = "in-flight"
	done     = "done"
	dead     = "dead"
)

func checkNamed(names ...string) {
	if slices.Contains(names, "") {
		panic("an empty name or payload")
	}
}

func checkOffset(offset int64) {
	if offset < 0 {
		panic("an offset is at least 0")
	}
}

// A consumer group: its members share one position in the topic. It covers the offsets
// from `start`; each one below `next` is in `state` or waiting in `again`.
type group struct {
	topic       string
	consumers   map[string]bool
	start, next int64
	again       []int64 // offsets to deliver again, ascending
	state       map[int64]string
	nacks       map[int64]int
	dead        []int64
}

func newGroup(topic string, start int64) *group {
	return &group{topic: topic, consumers: map[string]bool{}, start: start, next: start,
		state: map[int64]string{}, nacks: map[int64]int{}, dead: []int64{}}
}

func (g *group) take(most, end int64) []int64 {
	n := min(most, int64(len(g.again)))
	taken := slices.Clone(g.again[:n])
	g.again = g.again[n:]
	// Redeliveries are always below `next`, so this keeps offset order.
	fresh := min(most-int64(len(taken)), end-g.next)
	for i := int64(0); i < fresh; i++ {
		taken = append(taken, g.next+i)
	}
	g.next += fresh
	for _, offset := range taken {
		g.state[offset] = inFlight
	}
	return taken
}

func (g *group) settle(offset int64, acked bool) bool {
	if g.state[offset] != inFlight {
		return false
	}
	if acked {
		g.state[offset] = done
		return true
	}
	g.nacks[offset]++
	if g.nacks[offset] == maxNacks {
		g.state[offset] = dead
		g.dead = append(g.dead, offset)
	} else {
		g.toAgain(offset)
	}
	return true
}

func (g *group) rewind(offset int64) int64 {
	var made int64
	for o := offset; o < g.next; o++ {
		if s := g.state[o]; o < g.start || s == inFlight || s == done {
			delete(g.nacks, o)
			g.toAgain(o)
			made++
		}
	}
	g.start = min(g.start, offset)
	return made
}

func (g *group) toAgain(offset int64) {
	delete(g.state, offset)
	at, _ := slices.BinarySearch(g.again, offset)
	g.again = slices.Insert(g.again, at, offset)
}

// The mediator: publishers and consumer groups only ever talk to it, never to each other.
type Broker struct {
	topics map[string][]string
	groups map[string]*group
}

func NewBroker() *Broker {
	return &Broker{topics: map[string][]string{}, groups: map[string]*group{}}
}

func (b *Broker) publishMsg(topic string, payload string) int64 {
	checkNamed(topic, payload)
	b.topics[topic] = append(b.topics[topic], payload)
	return int64(len(b.topics[topic]) - 1)
}

func (b *Broker) subscribeGroup(name string, topic string, consumer string) {
	checkNamed(name, topic, consumer)
	g, ok := b.groups[name]
	if !ok {
		g = newGroup(topic, int64(len(b.topics[topic])))
		b.groups[name] = g
	} else if g.topic != topic {
		panic("a group reads one topic")
	}
	g.consumers[consumer] = true
}

func (b *Broker) poll(name string, consumer string, most int64) []string {
	g := b.findGroup(name)
	if !g.consumers[consumer] || most < 1 || most > maxPoll {
		panic("not a member, or max outside 1 to 100")
	}
	out := []string{}
	for _, o := range g.take(most, int64(len(b.topics[g.topic]))) {
		out = append(out, b.shown(g, o))
	}
	return out
}

func (b *Broker) ack(name string, offset int64) bool {
	g := b.findGroup(name)
	checkOffset(offset)
	return g.settle(offset, true)
}

func (b *Broker) nack(name string, offset int64) bool {
	g := b.findGroup(name)
	checkOffset(offset)
	return g.settle(offset, false)
}

func (b *Broker) deadLetters(name string) []string {
	g := b.findGroup(name)
	out := []string{}
	for _, o := range g.dead {
		out = append(out, b.shown(g, o))
	}
	return out
}

// The extension round: rewind a group to an earlier offset.
func (b *Broker) replayFrom(name string, offset int64) int64 {
	g := b.findGroup(name)
	checkOffset(offset)
	return g.rewind(offset)
}

func (b *Broker) shown(g *group, offset int64) string {
	return strconv.FormatInt(offset, 10) + ":" + b.topics[g.topic][offset]
}

func (b *Broker) findGroup(name string) *group {
	g, ok := b.groups[name]
	if !ok {
		panic("no such group")
	}
	return g
}
