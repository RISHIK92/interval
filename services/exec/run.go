package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// P5-W28-S01 (EXEC-3): one run, start to cleanup. The docker CLI is driven directly
// (os/exec), so the service has no dependencies: create, start attached with stdin
// piped, inspect, then always remove.

type Verdict string

const (
	OK           Verdict = "ok"
	RuntimeError Verdict = "runtime_error"
	TimeLimit    Verdict = "time_limit"
	MemoryLimit  Verdict = "memory_limit"
	OutputLimit  Verdict = "output_limit"
)

type Job struct {
	Language string
	Files    map[string]string
	Stdin    string
	Limits   Limits
}

type Result struct {
	Verdict  Verdict `json:"verdict"`
	ExitCode int     `json:"exitCode"`
	Stdout   string  `json:"stdout"`
	Stderr   string  `json:"stderr"`
	// The program's own running time, from the container's start to its exit; starting
	// the container isn't counted against it.
	TimeMs int64 `json:"timeMs"`
}

type Runner struct {
	// Where run directories are made. The Docker host must see the same path (the exec
	// service runs on the execution host itself, EXEC-5).
	WorkDir string
	Docker  string
	// "runsc" on the execution hosts (gVisor); empty uses Docker's default.
	Runtime string
}

var (
	errUnknownLanguage = errors.New("unknown language")
	errFileName        = errors.New("file name isn't a plain name")
	errNotRun          = errors.New("the container didn't run to its end")
)

// Starting a container (more so under gVisor) takes time the program never had; the
// wall-clock backstop allows for it, and the verdict uses the container's own clock.
const startAllowance = 10 * time.Second

// Each docker call but the attached start is bounded, so a wedged daemon fails the run
// instead of hanging it.
const dockerTimeout = 30 * time.Second

// capped keeps the first max bytes and calls over once when more arrive.
type capped struct {
	mu   sync.Mutex
	buf  bytes.Buffer
	max  int
	over func()
	hit  bool
}

func (c *capped) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	room := c.max - c.buf.Len()
	if len(p) > room {
		c.buf.Write(p[:max(room, 0)])
		if !c.hit {
			c.hit = true
			go c.over()
		}
		return len(p), nil
	}
	return c.buf.Write(p)
}

func (r *Runner) docker(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), dockerTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, r.Docker, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("docker %s: %w: %s", args[0], err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(string(out)), nil
}

// The run's input, checked before anything is made.
func check(job Job) (Language, error) {
	lang, ok := languages[job.Language]
	if !ok {
		return Language{}, fmt.Errorf("%w: %q", errUnknownLanguage, job.Language)
	}
	for name := range job.Files {
		if name == "" || name != filepath.Base(name) || name == "." || name == ".." {
			return Language{}, fmt.Errorf("%w: %q", errFileName, name)
		}
	}
	return lang, job.Limits.validate()
}

func (r *Runner) Run(ctx context.Context, job Job) (Result, error) {
	lang, err := check(job)
	if err != nil {
		return Result{}, err
	}
	dir, err := os.MkdirTemp(r.WorkDir, "run-")
	if err != nil {
		return Result{}, err
	}
	defer func() {
		if err := os.RemoveAll(dir); err != nil {
			fmt.Fprintln(os.Stderr, "exec: run dir not removed:", dir, err)
		}
	}()
	// Readable by the sandbox's user, which owns nothing here.
	if err := os.Chmod(dir, 0o755); err != nil {
		return Result{}, err
	}
	for name, body := range job.Files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			return Result{}, err
		}
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	// Named before it exists, so it is removed even if create fails after the daemon
	// made it.
	name := "interval-exec-" + randomHex()
	defer func() {
		if _, err := r.docker("rm", "-f", name); err != nil && !strings.Contains(err.Error(), "No such container") {
			fmt.Fprintln(os.Stderr, "exec: container not removed:", name, err)
		}
	}()
	spec := Spec{Name: name, Image: lang.Image, Cmd: lang.Cmd, RunDir: dir, Limits: job.Limits}
	if _, err := r.docker(spec.createArgs(r.Runtime)...); err != nil {
		return Result{}, err
	}
	return r.start(ctx, name, job)
}

func (r *Runner) start(ctx context.Context, name string, job Job) (Result, error) {
	cmd := exec.Command(r.Docker, "start", "-ai", name)
	var once sync.Once
	var timedOut atomic.Bool
	kill := func() {
		once.Do(func() {
			_, err := r.docker("kill", name)
			if err != nil && !strings.Contains(err.Error(), "is not running") && !strings.Contains(err.Error(), "No such container") {
				// The daemon didn't stop it: stop waiting on the attach; rm -f follows.
				fmt.Fprintln(os.Stderr, "exec: kill failed:", name, err)
				if cmd.Process != nil {
					_ = cmd.Process.Kill()
				}
			}
		})
	}
	limit := job.Limits.OutputKB * 1024
	stdout := &capped{max: limit, over: kill}
	stderr := &capped{max: limit, over: kill}
	cmd.Stdin = strings.NewReader(job.Stdin)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return Result{}, err
	}
	limitTime := time.Duration(job.Limits.Seconds) * time.Second
	expire := func() {
		timedOut.Store(true)
		kill()
	}
	// The backstop, if the start time can't be read.
	timer := time.AfterFunc(limitTime+startAllowance, expire)
	done := make(chan struct{})
	go r.deadline(name, limitTime, expire, done)
	stop := context.AfterFunc(ctx, kill)
	waitErr := cmd.Wait()
	close(done)
	timer.Stop()
	stop()
	var exitErr *exec.ExitError
	if waitErr != nil && !errors.As(waitErr, &exitErr) {
		return Result{}, waitErr
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	state, err := r.docker("inspect", "-f",
		"{{.State.Status}}|{{.State.OOMKilled}}|{{.State.ExitCode}}|{{.State.StartedAt}}|{{.State.FinishedAt}}|{{.State.Error}}",
		name)
	if err != nil {
		return Result{}, err
	}
	parts := strings.SplitN(state, "|", 6)
	if len(parts) != 6 || parts[0] != "exited" {
		// The CLI or the daemon failed, not the program: never a verdict.
		return Result{}, fmt.Errorf("%w: %s", errNotRun, state)
	}
	exit, err := strconv.Atoi(parts[2])
	if err != nil {
		return Result{}, fmt.Errorf("exit code %q: %w", parts[2], err)
	}
	began, err1 := time.Parse(time.RFC3339Nano, parts[3])
	ended, err2 := time.Parse(time.RFC3339Nano, parts[4])
	if err := errors.Join(err1, err2); err != nil {
		return Result{}, fmt.Errorf("container times: %w", err)
	}
	ran := ended.Sub(began)
	return Result{
		Verdict: verdict(outcome{
			output:   stdout.hit || stderr.hit,
			timedOut: timedOut.Load() || ran > limitTime,
			oom:      parts[1] == "true",
			exit:     exit,
		}),
		ExitCode: exit,
		Stdout:   stdout.buf.String(),
		Stderr:   stderr.buf.String(),
		TimeMs:   ran.Milliseconds(),
	}, nil
}

// Watches for the container to start, then kills it when its own time is up: the
// limit runs from the program's start, not from when it was asked for.
func (r *Runner) deadline(name string, limit time.Duration, expire func(), done <-chan struct{}) {
	poll := time.NewTicker(50 * time.Millisecond)
	defer poll.Stop()
	for {
		select {
		case <-done:
			return
		case <-poll.C:
		}
		state, err := r.docker("inspect", "-f", "{{.State.Status}}|{{.State.StartedAt}}", name)
		if err != nil {
			// The backstop timer still holds; the run's own result reports the cause.
			return
		}
		status, at, _ := strings.Cut(state, "|")
		if status != "running" {
			if status == "created" {
				continue
			}
			return
		}
		began, err := time.Parse(time.RFC3339Nano, at)
		if err != nil {
			return
		}
		select {
		case <-done:
		case <-time.After(time.Until(began.Add(limit))):
			expire()
		}
		return
	}
}

type outcome struct {
	output, timedOut, oom bool
	exit                  int
}

// One verdict, the first limit that applies: too much output, then too long, then too
// much memory, then the program's own failure.
func verdict(o outcome) Verdict {
	switch {
	case o.output:
		return OutputLimit
	case o.timedOut:
		return TimeLimit
	case o.oom:
		return MemoryLimit
	case o.exit != 0:
		return RuntimeError
	}
	return OK
}

func randomHex() string {
	b := make([]byte, 8)
	// crypto/rand.Read never fails on supported platforms (Go 1.24).
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
