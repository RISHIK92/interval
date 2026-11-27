package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// P7-W46 (Q-P7-02): `interval status` reads the companion API with the device token and
// shows the task and the suggestions' links; --json passes the answer through.

func statusServer(t *testing.T, code int, body string, seen *http.Request) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = *r.Clone(r.Context())
		w.WriteHeader(code)
		_, _ = w.Write([]byte(body))
	}))
}

const statusBody = `{"task":{"state":"running","startedAt":"2031-01-01T11:57:50.000Z","seconds":130},"chip":"3-8","suggestions":[{"title":"Why consensus","minutes":2,"url":"https://interval.test/read/10?moment=1&chip=3-8&pos=1&via=agent"},{"title":"Leases","minutes":null,"url":"https://interval.test/out?item=11&chip=3-8&pos=2&via=agent&target=section"}]}`

func TestStatusShowsTheTaskAndTheLinks(t *testing.T) {
	var seen http.Request
	srv := statusServer(t, 200, statusBody, &seen)
	defer srv.Close()
	h := newHarness(t, srv.URL)
	if code := run([]string{"status", "--chip", "3-8"}, h.deps); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	if seen.Method != http.MethodGet || seen.URL.Path != "/api/agent/status" || seen.URL.RawQuery != "chip=3-8" {
		t.Fatalf("asked %s %s?%s", seen.Method, seen.URL.Path, seen.URL.RawQuery)
	}
	if seen.Header.Get("Authorization") != "Bearer "+testToken {
		t.Fatalf("auth %q", seen.Header.Get("Authorization"))
	}
	want := "Agent: working for 2m 10s\n" +
		"For a 3–8 min break:\n" +
		"1. Why consensus · 2 min\n   https://interval.test/read/10?moment=1&chip=3-8&pos=1&via=agent\n" +
		"2. Leases\n   https://interval.test/out?item=11&chip=3-8&pos=2&via=agent&target=section\n"
	if h.stdout.String() != want {
		t.Fatalf("stdout:\n%s\nwant:\n%s", h.stdout, want)
	}
}

func TestStatusFinishedIdleAndJSON(t *testing.T) {
	var seen http.Request
	finished := `{"task":{"state":"finished","finishedAt":"2031-01-01T11:57:00.000Z"},"chip":"1-3","suggestions":[]}`
	srv := statusServer(t, 200, finished, &seen)
	defer srv.Close()
	h := newHarness(t, srv.URL)
	if code := run([]string{"status"}, h.deps); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if h.stdout.String() != "Agent: finished 3m 0s ago\nNo suggestions right now.\n" || seen.URL.RawQuery != "" {
		t.Fatalf("stdout %q, query %q", h.stdout, seen.URL.RawQuery)
	}
	h = newHarness(t, srv.URL)
	if code := run([]string{"status", "--json"}, h.deps); code != 0 || h.stdout.String() != finished+"\n" {
		t.Fatalf("json: %d %q", code, h.stdout)
	}
	if describeTask(agentStatus{}, h.deps.now()) != "idle" {
		t.Fatal("no state isn't idle")
	}
}

func TestStatusRefusalsAndUsage(t *testing.T) {
	for code, says := range map[int]string{401: "refused", 403: "plan doesn't include", 302: "redirects", 429: "answered 429"} {
		var seen http.Request
		srv := statusServer(t, code, "", &seen)
		h := newHarness(t, srv.URL)
		if exit := run([]string{"status"}, h.deps); exit != 1 || !strings.Contains(h.stderr.String(), says) {
			t.Fatalf("%d: exit %d, %s", code, exit, h.stderr)
		}
		srv.Close()
	}
	for _, args := range [][]string{{"status", "--chip"}, {"status", "--chip", "9-99"}, {"status", "now"}} {
		h := newHarness(t, "https://interval.test")
		if exit := run(args, h.deps); exit != 1 {
			t.Fatalf("%v: exit %d", args, exit)
		}
	}
	h := newHarness(t, "http://interval.test")
	if exit := run([]string{"status"}, h.deps); exit != 1 || !strings.Contains(h.stderr.String(), "https") {
		t.Fatalf("plain http: %d %s", exit, h.stderr)
	}
}

func TestStatusDropsControlCharactersFromTitles(t *testing.T) {
	var seen http.Request
	body := `{"task":{"state":"idle"},"chip":"1-3","suggestions":[{"title":"Raft\u001b]8;;https://evil.test\u0007 here\u009b2J","minutes":1,"url":"https://interval.test/read/1?chip=1-3&pos=1&via=agent\u001b[2J"}]}`
	srv := statusServer(t, 200, body, &seen)
	defer srv.Close()
	h := newHarness(t, srv.URL)
	if code := run([]string{"status"}, h.deps); code != 0 {
		t.Fatalf("exit %d", code)
	}
	out := h.stdout.String()
	if strings.ContainsAny(out, "\u001b\u0007\u009b") {
		t.Fatalf("a control character reached the terminal: %q", out)
	}
	if !strings.Contains(out, "1. Raft]8;;https://evil.test here2J · 1 min") {
		t.Fatalf("stdout %q", out)
	}
}
