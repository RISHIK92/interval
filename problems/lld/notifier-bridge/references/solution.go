package main

import "strings"

const (
	notifierMinLimit = 10
	notifierMaxLimit = 10000
)

// The implementor side of the bridge: how a channel marks a heading, breaks a line, and
// how long a message it carries. Channels know nothing about kinds.
type channel interface {
	heading(text string) string
	lineBreak() string
	state() *channelState
}

type channelState struct {
	limit int64
	sent  int64
}

func (s *channelState) state() *channelState { return s }

type emailChannel struct{ channelState }

func (*emailChannel) heading(text string) string { return "Subject: " + text }
func (*emailChannel) lineBreak() string          { return "\n" }

type chatChannel struct{ channelState }

func (*chatChannel) heading(text string) string { return "*" + text + "*" }
func (*chatChannel) lineBreak() string          { return "\n" }

type smsChannel struct{ channelState }

func (*smsChannel) heading(text string) string { return text }
func (*smsChannel) lineBreak() string          { return " | " }

// The extension's channel.
type pushChannel struct{ channelState }

func (*pushChannel) heading(text string) string { return text }
func (*pushChannel) lineBreak() string          { return " - " }

// The abstraction side: a kind lays its message out using only what a channel offers, so
// any kind works with any channel, and a new channel works with every kind it never heard
// of. fit decides what happens to a message over the channel's limit.
type message interface {
	layout(subject, body string) string
	fit(text string) string
}

// What every kind holds: the channel it is sent over.
type messageBase struct{ c channel }

// Over the channel's limit, the text is cut and ends in "...".
func (m messageBase) fit(text string) string {
	limit := m.c.state().limit
	if int64(len(text)) <= limit {
		return text
	}
	return text[:limit-3] + "..."
}

type alertMessage struct{ messageBase }

func (m alertMessage) layout(subject, body string) string {
	return m.c.heading("ALERT: "+subject) + m.c.lineBreak() + body
}

type digestMessage struct{ messageBase }

func (m digestMessage) layout(subject, body string) string {
	var out strings.Builder
	out.WriteString(m.c.heading("Digest: " + subject))
	for _, item := range strings.Split(body, ";") {
		item = strings.Trim(item, " ")
		if item != "" {
			out.WriteString(m.c.lineBreak() + "- " + item)
		}
	}
	return out.String()
}

type receiptMessage struct{ messageBase }

func (m receiptMessage) layout(subject, body string) string {
	return m.c.heading("Receipt: "+subject) + m.c.lineBreak() + body + m.c.lineBreak() + "Keep this for your records."
}

// A receipt is a record: cutting it short would lose what it is for.
func (m receiptMessage) fit(text string) string {
	if int64(len(text)) > m.c.state().limit {
		panic("a receipt never gets cut short")
	}
	return text
}

var notifierKinds = map[string]func(c channel) message{
	"alert":   func(c channel) message { return alertMessage{messageBase{c}} },
	"digest":  func(c channel) message { return digestMessage{messageBase{c}} },
	"receipt": func(c channel) message { return receiptMessage{messageBase{c}} },
}

type Notifier struct {
	channels map[string]channel
}

func NewNotifier() *Notifier {
	return &Notifier{channels: map[string]channel{
		"email": &emailChannel{channelState{limit: 2000}},
		"chat":  &chatChannel{channelState{limit: 500}},
		"sms":   &smsChannel{channelState{limit: 160}},
	}}
}

func (n *Notifier) send(kind string, channel string, subject string, body string) string {
	build, ok := notifierKinds[kind]
	if !ok {
		panic("unknown kind")
	}
	through := n.find(channel)
	if subject == "" || body == "" {
		panic("empty")
	}
	m := build(through)
	text := m.fit(m.layout(subject, body))
	through.state().sent++
	return text
}

func (n *Notifier) sent(channel string) int64 {
	return n.find(channel).state().sent
}

func (n *Notifier) channelLimit(channel string, maxChars int64) {
	through := n.find(channel)
	if maxChars < notifierMinLimit || maxChars > notifierMaxLimit {
		panic("a limit is 10 to 10000")
	}
	through.state().limit = maxChars
}

// The extension round: a fourth channel, and no kind changes.
func (n *Notifier) addPush() bool {
	if _, ok := n.channels["push"]; ok {
		return false
	}
	n.channels["push"] = &pushChannel{channelState{limit: 100}}
	return true
}

func (n *Notifier) find(name string) channel {
	found, ok := n.channels[name]
	if !ok {
		panic("unknown channel")
	}
	return found
}
