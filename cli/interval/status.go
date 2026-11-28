package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode"
)

// P7-W46 (Q-P7-02, owner 2026-11-20): `interval status` reads what the companion
// surfaces read: the agent's task as the hooks reported it, and 3 suggestions, each a
// link into the web app. ADR-0058: the feed's first articles, with no time chip.

type agentStatus struct {
	Task struct {
		State      string `json:"state"`
		Seconds    int    `json:"seconds"`
		FinishedAt string `json:"finishedAt"`
	} `json:"task"`
	Suggestions []struct {
		Title   string `json:"title"`
		Minutes *int   `json:"minutes"`
		URL     string `json:"url"`
	} `json:"suggestions"`
}

const (
	statusUsage = "usage: interval status [--json]"
	// A status body is three links and a state; anything much bigger isn't one.
	maxStatusBody = 64 << 10
)

func status(d deps, args []string) int {
	raw := false
	for _, arg := range args {
		if arg != "--json" {
			fmt.Fprintln(d.stderr, statusUsage)
			return 1
		}
		raw = true
	}
	site := strings.TrimRight(strings.TrimSpace(d.getenv("INTERVAL_URL")), "/")
	if site == "" {
		fmt.Fprintln(d.stderr, "interval: set INTERVAL_URL to your Interval site")
		return 1
	}
	if !safeSite(site) {
		fmt.Fprintln(d.stderr, "interval: INTERVAL_URL must be https (plain http only for localhost): the token travels with every call")
		return 1
	}
	tok, err := token(d)
	if err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	if !tokenShape.MatchString(tok) {
		fmt.Fprintln(d.stderr, "interval: the token isn't a device token (make one on your Interval Profile)")
		return 1
	}
	url := site + "/api/agent/status"
	ctx, cancel := context.WithTimeout(context.Background(), sendDeadline)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	res, err := d.client.Do(req)
	if err != nil {
		fmt.Fprintln(d.stderr, "interval: couldn't reach Interval:", err)
		return 1
	}
	defer func() { _ = res.Body.Close() }()
	switch {
	case res.StatusCode == http.StatusUnauthorized:
		fmt.Fprintln(d.stderr, "interval: the token was refused (revoked? make a new one on Profile)")
		return 1
	case res.StatusCode == http.StatusForbidden:
		fmt.Fprintln(d.stderr, "interval: your plan doesn't include the agent hook")
		return 1
	case res.StatusCode >= 300 && res.StatusCode < 400:
		fmt.Fprintln(d.stderr, "interval: INTERVAL_URL redirects: set it to the site's final address")
		return 1
	case res.StatusCode != http.StatusOK:
		fmt.Fprintln(d.stderr, "interval: Interval answered", res.StatusCode)
		return 1
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxStatusBody))
	if err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	var s agentStatus
	if err := json.Unmarshal(body, &s); err != nil {
		fmt.Fprintln(d.stderr, "interval: Interval's answer wasn't a status:", err)
		return 1
	}
	if raw {
		_, _ = d.stdout.Write(body)
		fmt.Fprintln(d.stdout)
		return 0
	}
	fmt.Fprintln(d.stdout, "Agent:", describeTask(s, d.now()))
	if len(s.Suggestions) == 0 {
		fmt.Fprintln(d.stdout, "No suggestions right now.")
		return 0
	}
	fmt.Fprintln(d.stdout, "Read while you wait:")
	for i, sug := range s.Suggestions {
		minutes := ""
		if sug.Minutes != nil {
			minutes = fmt.Sprintf(" · %d min", *sug.Minutes)
		}
		fmt.Fprintf(d.stdout, "%d. %s%s\n   %s\n", i+1, printable(sug.Title), minutes, printable(sug.URL))
	}
	return 0
}

func describeTask(s agentStatus, now time.Time) string {
	switch s.Task.State {
	case "running":
		return "working for " + duration(time.Duration(s.Task.Seconds)*time.Second)
	case "finished":
		at, err := time.Parse(time.RFC3339, s.Task.FinishedAt)
		if err != nil {
			return "finished"
		}
		return "finished " + duration(now.Sub(at)) + " ago"
	}
	return "idle"
}

func duration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	return fmt.Sprintf("%dm %ds", int(d.Minutes()), int(d.Seconds())%60)
}

// A title comes from a publisher's feed: its control characters (an escape sequence could
// rewrite the terminal or plant a link) are dropped before it reaches one.
func printable(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
}
