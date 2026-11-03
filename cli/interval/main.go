// The agent hook CLI (§7, ADR-0035): `interval start` and `interval stop` tell Interval
// that a coding agent began or finished a task, and nothing else: never prompts or
// code. A notification about 45 seconds into a task offers a quick session.
package main

import (
	"crypto/rand"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"
)

func main() {
	os.Exit(run(os.Args[1:], liveDeps()))
}

func liveDeps() deps {
	return deps{
		getenv:    os.Getenv,
		configDir: os.UserConfigDir,
		cacheDir:  os.UserCacheDir,
		client: &http.Client{
			Timeout: sendDeadline,
			// A redirect could carry the token elsewhere, or to plain http: never followed.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		random: rand.Reader,
		sleep:  time.Sleep,
		goos:   runtime.GOOS,
		spawn:  spawnWaiter,
		run:    func(name string, args ...string) error { return exec.Command(name, args...).Run() },
		stdout: os.Stdout,
		stderr: os.Stderr,
	}
}

// The waiter runs on after its parent (a hook) exits: its own process group, no stdio.
func spawnWaiter(nonce string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(self, "__wait", nonce)
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
