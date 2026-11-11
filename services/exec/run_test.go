package main

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// P5-W28-S01 (EXEC-3): real runs in Docker. Set EXEC_INTEGRATION=1 to run them; CI's
// runners and machines without Docker skip them.
func runner(t *testing.T) *Runner {
	t.Helper()
	if os.Getenv("EXEC_INTEGRATION") != "1" {
		t.Skip("EXEC_INTEGRATION not set")
	}
	return &Runner{WorkDir: t.TempDir(), Docker: "docker"}
}

func python(code, stdin string, limits Limits) Job {
	return Job{Language: "python", Files: map[string]string{"main.py": code}, Stdin: stdin, Limits: limits}
}

var small = Limits{MemoryMB: 64, CPUs: 1, Pids: 32, TmpMB: 8, Seconds: 3, OutputKB: 64}

func leftovers(t *testing.T, r *Runner) {
	t.Helper()
	out, err := exec.Command("docker", "ps", "-aq", "--filter", "label=interval.exec=1").Output()
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(out)) != "" {
		t.Errorf("containers left: %s", out)
	}
	entries, err := os.ReadDir(r.WorkDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("run dirs left: %d", len(entries))
	}
}

func TestVerdicts(t *testing.T) {
	r := runner(t)
	cases := []struct {
		name, code, stdin string
		verdict           Verdict
		stdout            string
		exit              int
	}{
		{"hello", `print("hello")`, "", OK, "hello\n", 0},
		{"stdin", `import sys; print(sys.stdin.read().upper(), end="")`, "abc", OK, "ABC", 0},
		{"exit", `raise SystemExit(3)`, "", RuntimeError, "", 3},
		{"loop", `while True: pass`, "", TimeLimit, "", -1},
		{"memory", `x = b"x" * (1024 * 1024 * 1024)`, "", MemoryLimit, "", -1},
		{"flood", `while True: print("x" * 1000)`, "", OutputLimit, "", -1},
		{"stderr flood", `import sys
while True: sys.stderr.write("x" * 1000)`, "", OutputLimit, "", -1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			start := time.Now()
			got, err := r.Run(context.Background(), python(c.code, c.stdin, small))
			if err != nil {
				t.Fatal(err)
			}
			if got.Verdict != c.verdict {
				t.Fatalf("verdict %s, want %s (stderr %q)", got.Verdict, c.verdict, got.Stderr)
			}
			if c.stdout != "" && got.Stdout != c.stdout {
				t.Errorf("stdout %q", got.Stdout)
			}
			if c.exit >= 0 && got.ExitCode != c.exit {
				t.Errorf("exit %d", got.ExitCode)
			}
			// The limit, plus starting and removing a container.
			if time.Since(start) > time.Duration(small.Seconds)*time.Second+8*time.Second {
				t.Errorf("took %s", time.Since(start))
			}
			if len(got.Stdout) > small.OutputKB*1024 {
				t.Errorf("stdout not capped: %d bytes", len(got.Stdout))
			}
			leftovers(t, r)
		})
	}
}

func TestNoHostEnvironmentReachesTheRun(t *testing.T) {
	r := runner(t)
	t.Setenv("INTERVAL_SECRET", "s3cret")
	got, err := r.Run(context.Background(), python(
		`import os; print(sorted(os.environ))`, "", small))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got.Stdout, "INTERVAL_SECRET") || strings.Contains(got.Stdout, "s3cret") {
		t.Errorf("host env leaked: %s", got.Stdout)
	}
	leftovers(t, r)
}

func TestACancelledRunStopsPromptlyAndLeavesNothing(t *testing.T) {
	r := runner(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	start := time.Now()
	_, err := r.Run(ctx, python(`while True: pass`, "", small))
	if err == nil {
		t.Fatal("no error")
	}
	if time.Since(start) > 15*time.Second {
		t.Errorf("took %s", time.Since(start))
	}
	leftovers(t, r)
}
