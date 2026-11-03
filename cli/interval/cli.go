package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const version = "0.1.0"

// What the CLI touches outside itself, so tests can stand in for each.
type deps struct {
	getenv    func(string) string
	configDir func() (string, error)
	cacheDir  func() (string, error)
	client    *http.Client
	random    io.Reader
	sleep     func(time.Duration)
	goos      string
	spawn     func(nonce string) error
	run       func(name string, args ...string) error
	stdout    io.Writer
	stderr    io.Writer
}

// The token Profile shows once (P3-W17-S04): ivd_ and 43 base64url characters.
var tokenShape = regexp.MustCompile(`^ivd_[A-Za-z0-9_-]{43}$`)

const (
	notifyAfter = 45 * time.Second // §7: "about 45 seconds later"
	tries       = 3                // the first call and two retries, with one key
	// All tries together: a hook runs before the agent goes on (Claude Code's
	// UserPromptSubmit holds the prompt), so an unreachable Interval costs at most this.
	sendDeadline = 3 * time.Second
	usage        = "usage: interval start | stop | login <token> | version"
)

// Exit codes: 0, also when Interval can't be reached (a hook must never break its
// agent); 1 for a missing token or site, a refused token, or bad usage.
func run(args []string, d deps) int {
	if len(args) == 0 {
		fmt.Fprintln(d.stderr, usage)
		return 1
	}
	switch args[0] {
	case "start":
		return send(d, "started")
	case "stop":
		return send(d, "finished")
	case "login":
		if len(args) != 2 {
			fmt.Fprintln(d.stderr, "usage: interval login <token>")
			return 1
		}
		return login(d, args[1])
	case "version":
		fmt.Fprintln(d.stdout, "interval", version)
		return 0
	case "__wait":
		if len(args) == 2 {
			wait(d, args[1])
		}
		return 0
	}
	fmt.Fprintln(d.stderr, usage)
	return 1
}

func login(d deps, token string) int {
	if !tokenShape.MatchString(token) {
		fmt.Fprintln(d.stderr, "interval: that isn't a device token (make one on your Interval Profile)")
		return 1
	}
	dir, err := d.configDir()
	if err != nil {
		fmt.Fprintln(d.stderr, "interval: no config folder:", err)
		return 1
	}
	path := filepath.Join(dir, "interval", "token")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	// The modes apply on creation only: a folder or file already there is narrowed too.
	if err := os.Chmod(filepath.Dir(path), 0o700); err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	if err := os.WriteFile(path, []byte(token+"\n"), 0o600); err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	if err := os.Chmod(path, 0o600); err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	fmt.Fprintln(d.stderr, "interval: token saved to", path)
	return 0
}

// INTERVAL_TOKEN, else the file `interval login` wrote.
func token(d deps) (string, error) {
	if t := strings.TrimSpace(d.getenv("INTERVAL_TOKEN")); t != "" {
		return t, nil
	}
	dir, err := d.configDir()
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(filepath.Join(dir, "interval", "token"))
	if err != nil {
		return "", errors.New("no token: run `interval login <token>` or set INTERVAL_TOKEN")
	}
	return strings.TrimSpace(string(raw)), nil
}

func marker(d deps) (string, error) {
	dir, err := d.cacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "interval", "running"), nil
}

func send(d deps, event string) int {
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
	key, err := randomHex(d, 16)
	if err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	// The marker goes first: a stop that runs while this start is still sending then
	// always clears it. Stopped: no notification from this task's waiter.
	nonce := ""
	if event == "started" {
		nonce = mark(d)
	} else if path, err := marker(d); err == nil {
		_ = os.Remove(path)
	}
	status, err := post(d, site+"/api/agent/"+event, tok, key)
	ok := false
	switch {
	case err != nil:
		fmt.Fprintln(d.stderr, "interval: couldn't reach Interval:", err)
	case status == http.StatusUnauthorized:
		fmt.Fprintln(d.stderr, "interval: the token was refused (revoked? make a new one on Profile)")
	case status >= 300 && status < 400:
		fmt.Fprintln(d.stderr, "interval: INTERVAL_URL redirects: set it to the site's final address")
	case status >= 400:
		fmt.Fprintln(d.stderr, "interval: Interval answered", status)
	default:
		ok = true
	}
	if event == "started" && nonce != "" {
		if ok {
			if err := d.spawn(nonce); err != nil {
				fmt.Fprintln(d.stderr, "interval: no notification:", err)
			}
		} else {
			unmark(d, nonce) // no task began: nothing to notify about
		}
	}
	if status == http.StatusUnauthorized || (status >= 300 && status < 400) {
		return 1
	}
	return 0
}

// https, or plain http to this machine only.
func safeSite(site string) bool {
	u, err := url.Parse(site)
	if err != nil || u.Host == "" {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	host := u.Hostname()
	return u.Scheme == "http" && (host == "localhost" || host == "127.0.0.1" || host == "::1")
}

// The whole request: only the idempotency key (C-09: never prompts or code). Retried
// with the same key, so a retry does nothing twice (LOAD-5).
func post(d deps, url, tok, key string) (int, error) {
	body, err := json.Marshal(map[string]string{"idempotency_key": key})
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), sendDeadline)
	defer cancel()
	var last error
	for attempt := range tries {
		if attempt > 0 {
			d.sleep(time.Duration(attempt) * 250 * time.Millisecond)
		}
		if ctx.Err() != nil {
			break
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return 0, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+tok)
		res, err := d.client.Do(req)
		if err != nil {
			last = err
			continue
		}
		_ = res.Body.Close()
		if res.StatusCode >= 500 {
			last = fmt.Errorf("status %d", res.StatusCode)
			continue
		}
		return res.StatusCode, nil
	}
	return 0, last
}

// A marker with a fresh nonce; the waiter notifies only if it still holds that nonce 45 s
// on: no stop since, and no newer start. "" when there's no notification to make.
// shortcut: one marker per machine, so with two agents running at once one's stop
// silences the other's notification; a per-session marker needs a session id, which
// only the hook's stdin has (never read).
func mark(d deps) string {
	if d.goos == "windows" {
		return "" // no notification on Windows (owner, 2026-11-03)
	}
	path, err := marker(d)
	if err != nil {
		fmt.Fprintln(d.stderr, "interval: no notification:", err)
		return ""
	}
	nonce, err := randomHex(d, 8)
	if err != nil {
		fmt.Fprintln(d.stderr, "interval: no notification:", err)
		return ""
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		fmt.Fprintln(d.stderr, "interval: no notification:", err)
		return ""
	}
	if err := os.WriteFile(path, []byte(nonce), 0o600); err != nil {
		fmt.Fprintln(d.stderr, "interval: no notification:", err)
		return ""
	}
	return nonce
}

// Removes the marker if it is still this start's.
func unmark(d deps, nonce string) {
	path, err := marker(d)
	if err != nil {
		return
	}
	if held, err := os.ReadFile(path); err == nil && string(held) == nonce {
		_ = os.Remove(path)
	}
}

const notice = "Your agent is still working. Open Interval for a quick session."

func wait(d deps, nonce string) {
	d.sleep(notifyAfter)
	path, err := marker(d)
	if err != nil {
		return
	}
	held, err := os.ReadFile(path)
	if err != nil || string(held) != nonce {
		return // stopped, or a newer task's waiter will say it
	}
	_ = notify(d)
}

// The OS's own notification: macOS and Linux; none on Windows.
func notify(d deps) error {
	switch d.goos {
	case "darwin":
		return d.run("osascript", "-e", fmt.Sprintf("display notification %q with title %q", notice, "Interval"))
	case "linux":
		return d.run("notify-send", "Interval", notice)
	}
	return nil
}

func randomHex(d deps, n int) (string, error) {
	b := make([]byte, n)
	if _, err := io.ReadFull(d.random, b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
