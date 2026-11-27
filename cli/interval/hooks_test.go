package main

import (
	"flag"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// P7-W46 (§7; Q-P7-01, owner 2026-11-20 and 2026-11-27): one golden file per installer;
// a merge keeps the user's own config and backs it up; a second run changes nothing;
// uninstall removes only Interval's; a hook always lets its agent go on.

var update = flag.Bool("update", false, "rewrite the golden files")

func configPath(h *harness, agent string) string {
	return agents[agent].file(h.deps, h.home)
}

func TestEachInstallerWritesItsGoldenConfig(t *testing.T) {
	for _, agent := range []string{"claude", "codex", "cursor", "gemini"} {
		t.Run(agent, func(t *testing.T) {
			h := newHarness(t, "https://interval.test")
			if code := run([]string{"hook", "install", "--agent", agent}, h.deps); code != 0 {
				t.Fatalf("exit %d: %s", code, h.stderr)
			}
			got, err := os.ReadFile(configPath(h, agent))
			if err != nil {
				t.Fatal(err)
			}
			golden := filepath.Join("testdata", "hooks", agent+".json")
			if *update {
				if err := os.WriteFile(golden, got, 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(golden)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != string(want) {
				t.Fatalf("%s:\n%s\nwant:\n%s", agent, got, want)
			}
			// A fresh file has no backup and is the user's alone.
			if _, err := os.Stat(configPath(h, agent) + backupSuffix); err == nil {
				t.Fatal("a backup of nothing")
			}
			info, _ := os.Stat(configPath(h, agent))
			if info.Mode().Perm() != 0o600 {
				t.Fatalf("mode %v", info.Mode().Perm())
			}
		})
	}
}

func TestCodexFollowsCodexHome(t *testing.T) {
	h := newHarness(t, "https://interval.test")
	h.env["CODEX_HOME"] = filepath.Join(h.home, "elsewhere")
	if code := run([]string{"hook", "install", "--agent", "codex"}, h.deps); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	if _, err := os.Stat(filepath.Join(h.home, "elsewhere", "hooks.json")); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(h.stdout.String(), "/hooks") {
		t.Fatalf("no word about Codex's trust step: %s", h.stdout)
	}
}

const usersOwn = `{
  "model": "opus",
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "say done" }] },
      { "hooks": [{ "type": "command", "command": "interval stop" }, { "type": "command", "command": "afplay ping.aiff" }] }
    ],
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "guard.sh" }] }]
  }
}
`

func TestAMergeKeepsTheUsersOwnAndASecondRunChangesNothing(t *testing.T) {
	h := newHarness(t, "https://interval.test")
	path := configPath(h, "claude")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(usersOwn), 0o644); err != nil {
		t.Fatal(err)
	}
	if code := run([]string{"hook", "install", "--agent", "claude"}, h.deps); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	got, _ := os.ReadFile(path)
	for _, kept := range []string{`"model": "opus"`, "say done", "afplay ping.aiff", "guard.sh", `"matcher": "Bash"`} {
		if !strings.Contains(string(got), kept) {
			t.Fatalf("lost %q:\n%s", kept, got)
		}
	}
	// The hand-written `interval stop` gives way to the installer's, once.
	if strings.Count(string(got), `"interval stop`) != 1 || !strings.Contains(string(got), "interval stop --for claude") {
		t.Fatalf("Interval's stop:\n%s", got)
	}
	if strings.Count(string(got), "interval start --for claude") != 1 {
		t.Fatalf("Interval's start:\n%s", got)
	}
	backup, _ := os.ReadFile(path + backupSuffix)
	if string(backup) != usersOwn {
		t.Fatalf("backup:\n%s", backup)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0o644 {
		t.Fatalf("the user's mode changed: %v", info.Mode().Perm())
	}
	// Again: nothing written, the backup still the user's original.
	h.stdout.Reset()
	if code := run([]string{"hook", "install", "--agent", "claude"}, h.deps); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	again, _ := os.ReadFile(path)
	if string(again) != string(got) || !strings.Contains(h.stdout.String(), "already") {
		t.Fatalf("a second run changed it:\n%s", again)
	}
	backup, _ = os.ReadFile(path + backupSuffix)
	if string(backup) != usersOwn {
		t.Fatal("a second run replaced the backup")
	}

	// Uninstall: only Interval's go, the user's hooks and settings stay.
	if code := run([]string{"hook", "uninstall", "--agent", "claude"}, h.deps); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	out, _ := os.ReadFile(path)
	if strings.Contains(string(out), "interval ") || strings.Contains(string(out), "UserPromptSubmit") {
		t.Fatalf("Interval's left behind:\n%s", out)
	}
	for _, kept := range []string{"say done", "afplay ping.aiff", "guard.sh", `"model": "opus"`} {
		if !strings.Contains(string(out), kept) {
			t.Fatalf("uninstall lost %q:\n%s", kept, out)
		}
	}
	h.stdout.Reset()
	if code := run([]string{"hook", "uninstall", "--agent", "claude"}, h.deps); code != 0 || !strings.Contains(h.stdout.String(), "No Interval hooks") {
		t.Fatalf("a second uninstall: %d %s", code, h.stdout)
	}
}

func TestUninstallOfAFreshInstallLeavesNoHooks(t *testing.T) {
	for _, agent := range []string{"claude", "codex", "cursor", "gemini"} {
		h := newHarness(t, "https://interval.test")
		_ = run([]string{"hook", "install", "--agent", agent}, h.deps)
		if code := run([]string{"hook", "uninstall", "--agent", agent}, h.deps); code != 0 {
			t.Fatalf("%s: exit %d: %s", agent, code, h.stderr)
		}
		out, _ := os.ReadFile(configPath(h, agent))
		if strings.Contains(string(out), "hooks") {
			t.Fatalf("%s: %s", agent, out)
		}
	}
}

func TestAFileThatIsntAJSONObjectIsLeftAlone(t *testing.T) {
	for _, body := range []string{"{ not json", `["a"]`, `{"hooks": []}`, `{"hooks": {"Stop": {}}}`} {
		h := newHarness(t, "https://interval.test")
		path := configPath(h, "claude")
		_ = os.MkdirAll(filepath.Dir(path), 0o700)
		_ = os.WriteFile(path, []byte(body), 0o600)
		if code := run([]string{"hook", "install", "--agent", "claude"}, h.deps); code != 1 {
			t.Fatalf("%q: exit %d", body, code)
		}
		got, _ := os.ReadFile(path)
		if string(got) != body {
			t.Fatalf("%q was rewritten: %s", body, got)
		}
		if _, err := os.Stat(path + backupSuffix); err == nil {
			t.Fatalf("%q: a backup", body)
		}
	}
}

func TestHookUsage(t *testing.T) {
	for _, args := range [][]string{
		{"hook"},
		{"hook", "install"},
		{"hook", "install", "--agent", "antigravity"},
		{"hook", "remove", "--agent", "claude"},
		{"start", "--for", "antigravity"},
	} {
		h := newHarness(t, "https://interval.test")
		if code := run(args, h.deps); code != 1 {
			t.Fatalf("%v: exit %d", args, code)
		}
	}
}

// What each agent reads from its hook's stdout, and an exit of 0 even when Interval
// can't be reached or the token is refused: a hook never stops its agent.
func TestAHookAnswersItsAgentAndNeverBlocks(t *testing.T) {
	f := &fakeServer{status: []int{401, 401}}
	srv := httptest.NewServer(f)
	defer srv.Close()
	want := map[string][2]string{
		"claude": {"", ""},
		"codex":  {"", "{}\n"},
		"cursor": {"{\"continue\":true}\n", "{}\n"},
		"gemini": {"{}\n", "{}\n"},
	}
	for agent, out := range want {
		for i, cmd := range []string{"start", "stop"} {
			h := newHarness(t, srv.URL)
			if agent == "claude" && cmd == "start" {
				f.status = []int{401}
			}
			if code := run([]string{cmd, "--for", agent}, h.deps); code != 0 {
				t.Fatalf("%s %s: exit %d", agent, cmd, code)
			}
			if h.stdout.String() != out[i] {
				t.Fatalf("%s %s: stdout %q", agent, cmd, h.stdout)
			}
		}
	}
	h := newHarness(t, "https://unreachable.invalid")
	h.env["INTERVAL_TOKEN"] = ""
	if code := run([]string{"start", "--for", "cursor"}, h.deps); code != 0 || h.stdout.String() != "{\"continue\":true}\n" {
		t.Fatalf("no token: exit %d, stdout %q", code, h.stdout)
	}
}

func TestASymlinkedConfigStaysALink(t *testing.T) {
	h := newHarness(t, "https://interval.test")
	dotfiles := filepath.Join(h.home, "dotfiles", "settings.json")
	_ = os.MkdirAll(filepath.Dir(dotfiles), 0o700)
	_ = os.WriteFile(dotfiles, []byte(`{"model": "opus"}`), 0o600)
	path := configPath(h, "claude")
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	if err := os.Symlink(dotfiles, path); err != nil {
		t.Fatal(err)
	}
	if code := run([]string{"hook", "install", "--agent", "claude"}, h.deps); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("the link was replaced by a file")
	}
	got, _ := os.ReadFile(dotfiles)
	if !strings.Contains(string(got), "interval start --for claude") || !strings.Contains(string(got), "opus") {
		t.Fatalf("the linked file: %s", got)
	}
}

func TestAReinstallLeavesInterval_sEntryWhereItIsAndNumbersAsWritten(t *testing.T) {
	h := newHarness(t, "https://interval.test")
	path := configPath(h, "codex")
	_ = run([]string{"hook", "install", "--agent", "codex"}, h.deps)
	// The user adds a hook after Interval's and a big number elsewhere.
	raw, _ := os.ReadFile(path)
	edited := strings.Replace(string(raw), `"Stop": [`, `"Stop": [`, 1)
	edited = strings.Replace(edited, `"timeout": 10,
            "type": "command"
          }
        ]
      }
    ],
    "UserPromptSubmit"`, `"timeout": 10,
            "type": "command"
          }
        ]
      },
      {
        "hooks": [
          {
            "command": "say done",
            "type": "command"
          }
        ]
      }
    ],
    "UserPromptSubmit"`, 1)
	edited = strings.Replace(edited, "{\n", "{\n  \"big\": 12345678901234567890,\n", 1)
	if edited == string(raw) {
		t.Fatal("the edit didn't apply")
	}
	_ = os.WriteFile(path, []byte(edited), 0o600)
	before, _ := os.ReadFile(path)
	h.stdout.Reset()
	if code := run([]string{"hook", "install", "--agent", "codex"}, h.deps); code != 0 {
		t.Fatalf("exit %d: %s", code, h.stderr)
	}
	after, _ := os.ReadFile(path)
	if !strings.Contains(h.stdout.String(), "already") {
		t.Fatalf("rewrote it: %s\n%s", h.stdout, after)
	}
	if string(after) != string(before) {
		t.Fatalf("changed:\n%s", after)
	}
}

func TestAHandWrittenFullPathCountsAsInterval_s(t *testing.T) {
	for _, command := range []string{"/opt/homebrew/bin/interval start", "interval stop", "interval start --for claude"} {
		if !isOurs(map[string]any{"command": command}) {
			t.Fatalf("%q isn't ours", command)
		}
	}
	for _, command := range []string{"say interval start", "intervals start", "interval start; rm -rf ~"} {
		if isOurs(map[string]any{"command": command}) {
			t.Fatalf("%q is ours", command)
		}
	}
}
