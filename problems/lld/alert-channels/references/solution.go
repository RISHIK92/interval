package main

import "strings"

// One way out. Each kind formats a message its own way and has its own price.
type alertChannel interface {
	price() int64
	format(message string) string
}

type emailChannel struct{}

func (emailChannel) price() int64 { return 1 }

func (emailChannel) format(message string) string { return "Subject: " + message }

type smsChannel struct{}

func (smsChannel) price() int64 { return 5 }

func (smsChannel) format(message string) string {
	if len(message) <= 20 {
		return message
	}
	return message[:17] + "..."
}

type pagerChannel struct{}

func (pagerChannel) price() int64 { return 25 }

func (pagerChannel) format(message string) string { return strings.ToUpper(message) + "!" }

type webhookChannel struct{ url string }

func (webhookChannel) price() int64 { return 2 }

func (w webhookChannel) format(message string) string { return "POST " + w.url + " " + message }

type alertEntry struct {
	channel alertChannel
	spent   int64
}

type AlertDispatcher struct {
	channels map[string]*alertEntry
}

func NewAlertDispatcher() *AlertDispatcher {
	return &AlertDispatcher{channels: map[string]*alertEntry{}}
}

func (d *AlertDispatcher) add(name string, channel alertChannel) {
	if _, taken := d.channels[name]; name == "" || taken {
		panic("a channel needs a new, non-empty name")
	}
	d.channels[name] = &alertEntry{channel: channel}
}

func (d *AlertDispatcher) find(name string) *alertEntry {
	e, ok := d.channels[name]
	if !ok {
		panic("no such channel")
	}
	return e
}

func (d *AlertDispatcher) addChannel(name string, kind string) {
	switch kind {
	case "email":
		d.add(name, emailChannel{})
	case "sms":
		d.add(name, smsChannel{})
	case "pager":
		d.add(name, pagerChannel{})
	default:
		panic("unknown kind")
	}
}

func (d *AlertDispatcher) send(channel string, message string) string {
	e := d.find(channel)
	e.spent += e.channel.price()
	return e.channel.format(message)
}

func (d *AlertDispatcher) cost(channel string) int64 {
	return d.find(channel).spent
}

// The extension round: a new kind, added without touching the others.
func (d *AlertDispatcher) addWebhook(name string, url string) {
	if !strings.HasPrefix(url, "https://") || len(url) <= len("https://") {
		panic("a webhook needs an https:// url")
	}
	d.add(name, webhookChannel{url: url})
}
