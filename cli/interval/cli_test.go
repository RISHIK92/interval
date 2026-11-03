package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// P3-W17-S05a (§7, C-09, LOAD-5, ADR-0035): the CLI sends only the two events, each a
// key and nothing else; a retry reuses the key; a hook never breaks its agent.

const testToken = "ivd_" + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"

type call struct {
	path, auth string
	body       map[string]any
	raw        string
}

type fakeServer struct {
	mu     sync.Mutex
	calls  []call
	status []int // answered in turn; then 200
}

func (f *fakeServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	f.mu.Lock()
	f.calls = append(f.calls, call{r.URL.Path, r.Header.Get("Authorization"), body, string(raw)})
	code := http.StatusOK
	if len(f.status) > 0 {
		code, f.status = f.status[0], f.status[1:]
	}
	f.mu.Unlock()
	w.WriteHeader(code)
}

// Every read is fresh (a counter), so keys and nonces never repeat.
type counter struct{ n byte }

func (c *counter) Read(p []byte) (int, error) {
	for i := range p {
		c.n++
		p[i] = c.n
	}
	return len(p), nil
}

type harness struct {
	deps    deps
	stdout  *bytes.Buffer
	stderr  *bytes.Buffer
	spawned []string
	ran     [][]string
	slept   []time.Duration
	config  string
	cache   string
	env     map[string]string
}

func newHarness(t *testing.T, site string) *harness {
	t.Helper()
	h := &harness{
		stdout: &bytes.Buffer{},
		stderr: &bytes.Buffer{},
		config: t.TempDir(),
		cache:  t.TempDir(),
		env:    map[string]string{"INTERVAL_URL": site, "INTERVAL_TOKEN": testToken},
	}
	h.deps = deps{
		getenv:    func(k string) string { return h.env[k] },
		configDir: func() (string, error) { return h.config, nil },
		cacheDir:  func() (string, error) { return h.cache, nil },
		client:    &http.Client{Timeout: 2 * time.Second},
		random:    &counter{},
		sleep:     func(d time.Duration) { h.slept = append(h.slept, d) },
		goos:      "darwin",
		spawn:     func(nonce string) error { h.spawned = append(h.spawned, nonce); return nil },
		run: func(name string, args ...string) error {
			h.ran = append(h.ran, append([]string{name}, args...))
			return nil
		},
		stdout: h.stdout,
		stderr: h.stderr,
	}
	return h
}

func TestStartAndStopSendOnlyAKey(t *testing.T) {
	f := &fakeServer{}
	srv := httptest.NewServer(f)
	defer srv.Close()
	h := newHarness(t, srv.URL)
	// A hook's stdin (Claude Code's JSON, with the prompt) is there; the body still
	// holds only the key.
	old := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString(`{"prompt":"refactor the payment code","cwd":"/secret"}`)
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = old }()

	if code := run([]string{"start"}, h.deps); code != 0 {
		t.Fatalf("start exited %d: %s", code, h.stderr)
	}
	if code := run([]string{"stop"}, h.deps); code != 0 {
		t.Fatalf("stop exited %d: %s", code, h.stderr)
	}
	if len(f.calls) != 2 || f.calls[0].path != "/api/agent/started" || f.calls[1].path != "/api/agent/finished" {
		t.Fatalf("calls: %+v", f.calls)
	}
	for _, c := range f.calls {
		if c.auth != "Bearer "+testToken {
			t.Fatalf("auth %q", c.auth)
		}
		if len(c.body) != 1 || c.body["idempotency_key"] == nil {
			t.Fatalf("a body held more than its key: %s", c.raw)
		}
		if strings.Contains(c.raw, "prompt") || strings.Contains(c.raw, "secret") {
			t.Fatalf("leaked: %s", c.raw)
		}
	}
	if f.calls[0].body["idempotency_key"] == f.calls[1].body["idempotency_key"] {
		t.Fatal("start and stop shared a key")
	}
}

func TestARetryReusesTheKey(t *testing.T) {
	f := &fakeServer{status: []int{503, 502}}
	srv := httptest.NewServer(f)
	defer srv.Close()
	h := newHarness(t, srv.URL)
	if code := run([]string{"start"}, h.deps); code != 0 {
		t.Fatalf("exited %d", code)
	}
	if len(f.calls) != 3 {
		t.Fatalf("%d calls", len(f.calls))
	}
	if f.calls[0].body["idempotency_key"] != f.calls[2].body["idempotency_key"] {
		t.Fatal("a retry changed its key")
	}
}

func TestARefusedTokenExitsOneAndUnreachableExitsZero(t *testing.T) {
	f := &fakeServer{status: []int{401}}
	srv := httptest.NewServer(f)
	h := newHarness(t, srv.URL)
	if code := run([]string{"stop"}, h.deps); code != 1 || !strings.Contains(h.stderr.String(), "the token was refused") {
		t.Fatalf("exited %d: %s", code, h.stderr)
	}
	srv.Close()
	h2 := newHarness(t, srv.URL)
	if code := run([]string{"start"}, h2.deps); code != 0 || !strings.Contains(h2.stderr.String(), "couldn't reach") {
		t.Fatalf("exited %d: %s", code, h2.stderr)
	}
	if len(h2.spawned) != 0 {
		t.Fatal("a start that never arrived waits to notify")
	}
}

func TestNoSiteOrTokenSaysSo(t *testing.T) {
	h := newHarness(t, "")
	if code := run([]string{"start"}, h.deps); code != 1 || !strings.Contains(h.stderr.String(), "INTERVAL_URL") {
		t.Fatalf("exited %d: %s", code, h.stderr)
	}
	h = newHarness(t, "http://127.0.0.1:1")
	delete(h.env, "INTERVAL_TOKEN")
	if code := run([]string{"start"}, h.deps); code != 1 || !strings.Contains(h.stderr.String(), "interval login") {
		t.Fatalf("exited %d: %s", code, h.stderr)
	}
}

func TestLoginKeepsTheTokenPrivateAndRefusesOthers(t *testing.T) {
	h := newHarness(t, "")
	if code := run([]string{"login", "hunter2"}, h.deps); code != 1 {
		t.Fatalf("a malformed token was taken")
	}
	if code := run([]string{"login", testToken}, h.deps); code != 0 {
		t.Fatalf("exited %d: %s", code, h.stderr)
	}
	path := filepath.Join(h.config, "interval", "token")
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v %v", info, err)
	}
	// Used when INTERVAL_TOKEN isn't set.
	f := &fakeServer{}
	srv := httptest.NewServer(f)
	defer srv.Close()
	h.env = map[string]string{"INTERVAL_URL": srv.URL}
	if code := run([]string{"start"}, h.deps); code != 0 || f.calls[0].auth != "Bearer "+testToken {
		t.Fatalf("exited %d: %+v", code, f.calls)
	}
}

func TestTheWaiterNotifiesOnlyWhileItsTaskRuns(t *testing.T) {
	f := &fakeServer{}
	srv := httptest.NewServer(f)
	defer srv.Close()
	h := newHarness(t, srv.URL)
	run([]string{"start"}, h.deps)
	if len(h.spawned) != 1 {
		t.Fatalf("spawned %v", h.spawned)
	}
	nonce := h.spawned[0]
	run([]string{"__wait", nonce}, h.deps)
	if len(h.slept) == 0 || h.slept[len(h.slept)-1] != 45*time.Second {
		t.Fatalf("slept %v", h.slept)
	}
	if len(h.ran) != 1 || h.ran[0][0] != "osascript" || !strings.Contains(strings.Join(h.ran[0], " "), "still working") {
		t.Fatalf("ran %v", h.ran)
	}
	// Stopped: its waiter says nothing.
	run([]string{"stop"}, h.deps)
	run([]string{"__wait", nonce}, h.deps)
	if len(h.ran) != 1 {
		t.Fatalf("notified after stop: %v", h.ran)
	}
	// A newer start: the older waiter says nothing.
	run([]string{"start"}, h.deps)
	run([]string{"start"}, h.deps)
	if h.spawned[1] == h.spawned[2] {
		t.Fatal("two starts shared a nonce")
	}
	run([]string{"__wait", h.spawned[1]}, h.deps)
	if len(h.ran) != 1 {
		t.Fatalf("an older waiter notified: %v", h.ran)
	}
}

func TestTheNotificationPerSystem(t *testing.T) {
	h := newHarness(t, "")
	h.deps.goos = "linux"
	_ = notify(h.deps)
	if h.ran[0][0] != "notify-send" {
		t.Fatalf("ran %v", h.ran)
	}
	h.deps.goos = "windows"
	_ = notify(h.deps)
	if len(h.ran) != 1 {
		t.Fatalf("Windows notified: %v", h.ran)
	}
	// And no waiter is started there.
	f := &fakeServer{}
	srv := httptest.NewServer(f)
	defer srv.Close()
	h.env["INTERVAL_URL"] = srv.URL
	run([]string{"start"}, h.deps)
	if len(h.spawned) != 0 {
		t.Fatal("a waiter on Windows")
	}
}

func TestUsage(t *testing.T) {
	h := newHarness(t, "")
	if run(nil, h.deps) != 1 || run([]string{"nope"}, h.deps) != 1 {
		t.Fatal("bad usage passed")
	}
	if run([]string{"version"}, h.deps) != 0 || !strings.Contains(h.stdout.String(), "interval ") {
		t.Fatal("version failed")
	}
}

func TestAnAnswerOtherThanOKStartsNoWaiter(t *testing.T) {
	for _, code := range []int{400, 429} {
		f := &fakeServer{status: []int{code}}
		srv := httptest.NewServer(f)
		h := newHarness(t, srv.URL)
		if exit := run([]string{"start"}, h.deps); exit != 0 {
			t.Fatalf("%d: exited %d", code, exit)
		}
		if len(h.spawned) != 0 {
			t.Fatalf("%d: a waiter", code)
		}
		if _, err := os.Stat(filepath.Join(h.cache, "interval", "running")); !os.IsNotExist(err) {
			t.Fatalf("%d: a marker left: %v", code, err)
		}
		srv.Close()
	}
}

// A redirect could carry the token elsewhere: it's not followed, and it's said.
func TestARedirectIsNotFollowed(t *testing.T) {
	var followed bool
	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { followed = true }))
	defer other.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+r.URL.Path, http.StatusFound)
	}))
	defer srv.Close()
	h := newHarness(t, srv.URL)
	h.deps.client = liveDeps().client
	if code := run([]string{"start"}, h.deps); code != 1 || !strings.Contains(h.stderr.String(), "redirects") {
		t.Fatalf("exited %d: %s", code, h.stderr)
	}
	if followed {
		t.Fatal("the redirect was followed")
	}
}

func TestOnlyHTTPSCarriesTheTokenAwayFromThisMachine(t *testing.T) {
	h := newHarness(t, "http://interval.example")
	if code := run([]string{"start"}, h.deps); code != 1 || !strings.Contains(h.stderr.String(), "https") {
		t.Fatalf("exited %d: %s", code, h.stderr)
	}
	for _, site := range []string{"https://interval.example", "http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"} {
		if !safeSite(site) {
			t.Errorf("%s refused", site)
		}
	}
	for _, site := range []string{"ftp://x", "http://interval.example", "localhost:3100", ""} {
		if safeSite(site) {
			t.Errorf("%s allowed", site)
		}
	}
}

func TestLoginNarrowsATokenFileAlreadyThere(t *testing.T) {
	h := newHarness(t, "")
	path := filepath.Join(h.config, "interval", "token")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, []byte("old"), 0o644)
	if code := run([]string{"login", testToken}, h.deps); code != 0 {
		t.Fatalf("exited %d", code)
	}
	file, _ := os.Stat(path)
	dir, _ := os.Stat(filepath.Dir(path))
	if file.Mode().Perm() != 0o600 || dir.Mode().Perm() != 0o700 {
		t.Fatalf("file %v, folder %v", file.Mode(), dir.Mode())
	}
}

// The Stop hook can run while start's call is still out: the stop wins.
func TestAStopDuringStartsCallWins(t *testing.T) {
	var h *harness
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/agent/started" {
			run([]string{"stop"}, h.deps) // the other hook, meanwhile
		}
	}))
	defer srv.Close()
	h = newHarness(t, srv.URL)
	run([]string{"start"}, h.deps)
	if len(h.spawned) != 1 {
		t.Fatalf("spawned %v", h.spawned)
	}
	run([]string{"__wait", h.spawned[0]}, h.deps)
	if len(h.ran) != 0 {
		t.Fatalf("notified for a stopped task: %v", h.ran)
	}
}

// An unreachable Interval holds a hook for the deadline at most, all tries together.
func TestAnUnreachableSiteCostsAtMostTheDeadline(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		<-release
	}))
	defer srv.Close()
	defer close(release)
	h := newHarness(t, srv.URL)
	h.deps.client = &http.Client{}
	began := time.Now()
	if code := run([]string{"start"}, h.deps); code != 0 {
		t.Fatalf("exited %d", code)
	}
	if took := time.Since(began); took > sendDeadline+time.Second {
		t.Fatalf("took %v", took)
	}
}
