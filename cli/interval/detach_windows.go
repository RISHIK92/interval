//go:build windows

package main

import "os/exec"

// Windows shows no notification (owner, 2026-11-03), so no waiter is started there.
func detach(*exec.Cmd) {}
