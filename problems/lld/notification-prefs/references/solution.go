package main

import "slices"

var notifyChannels = []string{"email", "push", "sms"} // sorted

func checkUser(user string) {
	if user == "" {
		panic("a user is not empty")
	}
}

func checkChannel(user string, channel string) {
	checkUser(user)
	if !slices.Contains(notifyChannels, channel) {
		panic("unknown channel")
	}
}

func checkHour(hour int64) {
	if hour < 0 || hour > 23 {
		panic("an hour is from 0 to 23")
	}
}

// When a user doesn't want to be disturbed; knows nothing about channels. The same
// start and end is an empty window.
type quietHours struct{ start, end int64 }

func (q quietHours) contains(hour int64) bool {
	if q.start <= q.end {
		return hour >= q.start && hour < q.end
	}
	return hour >= q.start || hour < q.end // wraps past midnight
}

// What one user chose. It answers questions about itself and never routes.
type preferences struct {
	optedOut map[string]bool
	quiet    *quietHours
	digested map[string]bool
	pending  map[string]int64 // channel -> messages held for the digest
}

func (p *preferences) isQuiet(hour int64) bool {
	return p.quiet != nil && p.quiet.contains(hour)
}

// Keeps preferences and decides delivery; sending is someone else's job.
type NotificationPrefs struct {
	users map[string]*preferences
}

func NewNotificationPrefs() *NotificationPrefs {
	return &NotificationPrefs{users: map[string]*preferences{}}
}

func (n *NotificationPrefs) prefs(user string) *preferences {
	p, ok := n.users[user]
	if !ok {
		p = &preferences{optedOut: map[string]bool{}, digested: map[string]bool{}, pending: map[string]int64{}}
		n.users[user] = p
	}
	return p
}

func (n *NotificationPrefs) optOut(user string, channel string) {
	checkChannel(user, channel)
	p := n.prefs(user)
	p.optedOut[channel] = true
	delete(p.pending, channel)
}

func (n *NotificationPrefs) quietHours(user string, startHour int64, endHour int64) {
	checkUser(user)
	checkHour(startHour)
	checkHour(endHour)
	n.prefs(user).quiet = &quietHours{start: startHour, end: endHour}
}

func (n *NotificationPrefs) route(user string, channel string, hour int64, urgent bool) bool {
	checkChannel(user, channel)
	checkHour(hour)
	p := n.prefs(user)
	if p.optedOut[channel] {
		return false
	}
	if urgent {
		return true
	}
	if p.digested[channel] {
		p.pending[channel]++
		return false
	}
	return !p.isQuiet(hour)
}

func (n *NotificationPrefs) channels(user string) []string {
	checkUser(user)
	p := n.prefs(user)
	out := []string{}
	for _, c := range notifyChannels {
		if !p.optedOut[c] {
			out = append(out, c)
		}
	}
	return out
}

// The extension round: non-urgent messages on a digest channel wait for the digest.
func (n *NotificationPrefs) digest(user string, channel string) {
	checkChannel(user, channel)
	n.prefs(user).digested[channel] = true
}

func (n *NotificationPrefs) flushDigest(user string) int64 {
	checkUser(user)
	p := n.prefs(user)
	held := int64(0)
	for _, count := range p.pending {
		held += count
	}
	p.pending = map[string]int64{}
	return held
}
