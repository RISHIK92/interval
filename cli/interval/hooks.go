package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// P7-W46 (§7; Q-P7-01, owner 2026-11-20 and 2026-11-27): `interval hook install --agent
// <name>` writes Interval's start and stop into an agent's user-level hook config (never
// a project's, which could be committed and turn the hook on for others), merged with
// what's there, the file before kept as a backup; a second run changes nothing.
// `uninstall` removes only Interval's entries. Each agent's format is its own docs' (checked
// 2026-11-27).

type agentSpec struct {
	// The user-level file, from the home folder (Codex: from CODEX_HOME when set).
	file func(d deps, home string) string
	// The agent's events for "a prompt was sent" and "the turn finished".
	start, stop string
	// One entry under an event, running `command`.
	entry func(event, command string) any
	// Top-level keys the file needs (Cursor's version), set only when missing.
	top map[string]any
	// Said after an install: what else the user must do, or know.
	note string
}

var agents = map[string]agentSpec{
	// https://code.claude.com/docs/en/hooks
	"claude": {
		file:  func(_ deps, home string) string { return filepath.Join(home, ".claude", "settings.json") },
		start: "UserPromptSubmit",
		stop:  "Stop",
		entry: func(_, command string) any {
			return map[string]any{"hooks": []any{map[string]any{"type": "command", "command": command}}}
		},
	},
	// https://developers.openai.com/codex/hooks: hooks.json, not config.toml (one format a
	// layer, and JSON needs no new dependency).
	"codex": {
		file: func(d deps, home string) string {
			if dir := strings.TrimSpace(d.getenv("CODEX_HOME")); dir != "" {
				return filepath.Join(dir, "hooks.json")
			}
			return filepath.Join(home, ".codex", "hooks.json")
		},
		start: "UserPromptSubmit",
		stop:  "Stop",
		entry: func(_, command string) any {
			return map[string]any{"hooks": []any{map[string]any{"type": "command", "command": command, "timeout": 10}}}
		},
		note: "Codex runs a new hook only once you trust it: open /hooks in Codex and trust Interval's two.",
	},
	// https://cursor.com/docs/hooks
	"cursor": {
		file:  func(_ deps, home string) string { return filepath.Join(home, ".cursor", "hooks.json") },
		start: "beforeSubmitPrompt",
		stop:  "stop",
		entry: func(_, command string) any {
			return map[string]any{"command": command, "timeout": 10}
		},
		top:  map[string]any{"version": 1},
		note: "Restart Cursor if the hooks don't load. User hooks don't run in Cursor's cloud agents.",
	},
	// https://geminicli.com/docs/hooks/ (timeouts in milliseconds)
	"gemini": {
		file:  func(_ deps, home string) string { return filepath.Join(home, ".gemini", "settings.json") },
		start: "BeforeAgent",
		stop:  "AfterAgent",
		entry: func(event, command string) any {
			name := "interval-stop"
			if event == "BeforeAgent" {
				name = "interval-start"
			}
			return map[string]any{"hooks": []any{map[string]any{
				"name": name, "type": "command", "command": command, "timeout": 5000,
			}}}
		},
		note: "Gemini CLI now serves paid API-key and enterprise users only (Antigravity CLI replaced it for others on 18 June 2026; it has no installer yet: run `interval start`/`stop` by hand).",
	},
}

// Interval's own commands, whatever agent they name: what uninstall (and a reinstall)
// removes, and nothing else.
// A hand-written one by its full path (/opt/homebrew/bin/interval start) counts too.
var ours = regexp.MustCompile(`^(\S*/)?interval (start|stop)( --for [a-z]+)?$`)

const hookUsage = "usage: interval hook install|uninstall --agent claude|codex|cursor|gemini"

func hook(d deps, args []string) int {
	if len(args) != 3 || (args[0] != "install" && args[0] != "uninstall") || args[1] != "--agent" {
		fmt.Fprintln(d.stderr, hookUsage)
		return 1
	}
	name := args[2]
	spec, ok := agents[name]
	if !ok {
		fmt.Fprintln(d.stderr, hookUsage)
		return 1
	}
	home, err := d.homeDir()
	if err != nil {
		fmt.Fprintln(d.stderr, "interval: no home folder:", err)
		return 1
	}
	path := spec.file(d, home)
	// A dotfiles manager's symlink stays one: the file it points at is what changes.
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	config, mode, existed, err := readConfig(path)
	if err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	before, err := encode(config)
	if err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	install := args[0] == "install"
	hooks, err := hooksOf(config, path)
	if err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	removed := false
	for _, event := range []string{spec.start, spec.stop} {
		command := "interval stop --for " + name
		if event == spec.start {
			command = "interval start --for " + name
		}
		// Already exactly as an install writes it: left where it is, so a second run
		// changes nothing even after the user added hooks behind it.
		if install && exactlyOnce(hooks[event], spec.entry(event, command)) {
			continue
		}
		kept, dropped, err := withoutOurs(hooks[event], path, event)
		if err != nil {
			fmt.Fprintln(d.stderr, "interval:", err)
			return 1
		}
		removed = removed || dropped
		if install {
			kept = append(kept, spec.entry(event, command))
		}
		if len(kept) == 0 {
			delete(hooks, event)
		} else {
			hooks[event] = kept
		}
	}
	if len(hooks) == 0 {
		delete(config, "hooks")
	} else {
		config["hooks"] = hooks
	}
	if install {
		for key, value := range spec.top {
			if _, set := config[key]; !set {
				config[key] = value
			}
		}
	}
	after, err := encode(config)
	if err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	if !install && !removed {
		fmt.Fprintln(d.stdout, "No Interval hooks in", path)
		return 0
	}
	if existed && bytes.Equal(before, after) {
		fmt.Fprintln(d.stdout, "Interval's hooks are already in", path)
		return 0
	}
	if err := writeConfig(path, after, mode, existed); err != nil {
		fmt.Fprintln(d.stderr, "interval:", err)
		return 1
	}
	if install {
		fmt.Fprintln(d.stdout, "Interval's hooks are in", path)
	} else {
		fmt.Fprintln(d.stdout, "Interval's hooks are out of", path)
	}
	if existed {
		fmt.Fprintln(d.stdout, "The file before is kept as", path+backupSuffix)
	}
	if install && spec.note != "" {
		fmt.Fprintln(d.stdout, spec.note)
	}
	return 0
}

const backupSuffix = ".interval-backup"

// The file as an object, its mode, and whether it was there. A file that isn't a JSON
// object is left alone: rewriting it could lose what the user wrote.
func readConfig(path string) (map[string]any, fs.FileMode, bool, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]any{}, 0o600, false, nil
	}
	if err != nil {
		return nil, 0, false, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, 0, false, err
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return map[string]any{}, info.Mode().Perm(), true, nil
	}
	// Numbers kept as written (UseNumber): a float64 would round big ones and reformat
	// others.
	var config map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&config); err != nil || config == nil || dec.More() {
		return nil, 0, false, fmt.Errorf("%s isn't a JSON object, so it's left as it is: fix it, then run this again", path)
	}
	return config, info.Mode().Perm(), true, nil
}

func hooksOf(config map[string]any, path string) (map[string]any, error) {
	raw, ok := config["hooks"]
	if !ok {
		return map[string]any{}, nil
	}
	hooks, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf(`%s: "hooks" isn't an object, so it's left as it is`, path)
	}
	return hooks, nil
}

// An event's entries without Interval's: a whole entry when its command is ours (Cursor),
// else only our commands inside a group, and a group left empty by that.
func withoutOurs(raw any, path, event string) ([]any, bool, error) {
	if raw == nil {
		return nil, false, nil
	}
	list, ok := raw.([]any)
	if !ok {
		return nil, false, fmt.Errorf(`%s: hooks.%s isn't a list, so it's left as it is`, path, event)
	}
	kept := []any{}
	dropped := false
	for _, entry := range list {
		group, ok := entry.(map[string]any)
		if !ok {
			kept = append(kept, entry)
			continue
		}
		if isOurs(group) {
			dropped = true
			continue
		}
		inner, ok := group["hooks"].([]any)
		if !ok {
			kept = append(kept, entry)
			continue
		}
		left := []any{}
		for _, h := range inner {
			if m, ok := h.(map[string]any); ok && isOurs(m) {
				dropped = true
				continue
			}
			left = append(left, h)
		}
		if len(left) == 0 {
			continue
		}
		copied := make(map[string]any, len(group))
		for k, v := range group {
			copied[k] = v
		}
		copied["hooks"] = left
		kept = append(kept, copied)
	}
	return kept, dropped, nil
}

// The event holds Interval's entry exactly as an install writes it, and no other of
// Interval's.
func exactlyOnce(raw any, want any) bool {
	list, ok := raw.([]any)
	if !ok {
		return false
	}
	wanted, err := json.Marshal(want)
	if err != nil {
		return false
	}
	found := 0
	for _, entry := range list {
		got, err := json.Marshal(entry)
		if err != nil {
			return false
		}
		if bytes.Equal(got, wanted) {
			found++
			continue
		}
		if _, dropped, err := withoutOurs([]any{entry}, "", ""); err != nil || dropped {
			return false
		}
	}
	return found == 1
}

func isOurs(m map[string]any) bool {
	command, ok := m["command"].(string)
	return ok && ours.MatchString(strings.TrimSpace(command))
}

// Two-space JSON with sorted keys (encoding/json sorts maps), so a second run compares
// equal byte for byte.
func encode(config map[string]any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(config); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// The backup first, then the new file beside it and renamed over, so a crash leaves the
// old file or the new one, never half of one.
func writeConfig(path string, data []byte, mode fs.FileMode, existed bool) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if existed {
		old, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.WriteFile(path+backupSuffix, old, mode); err != nil {
			return err
		}
		// WriteFile keeps an older backup's mode: narrowed to the file's own.
		if err := os.Chmod(path+backupSuffix, mode); err != nil {
			return err
		}
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer func() { _ = os.Remove(name) }()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(name, mode); err != nil {
		return err
	}
	return os.Rename(name, path)
}

// What each agent needs on stdout from its hook (their docs, 2026-11-27): Claude Code
// takes plain stdout from a prompt hook as context, so nothing; Codex wants JSON from
// Stop; Cursor's prompt hook answers whether to continue; Gemini parses every hook's
// stdout as JSON. Never a block: always "go on".
func hookOutput(agent, event string) (string, bool) {
	switch agent {
	case "claude":
		return "", true
	case "codex":
		if event == "started" {
			return "", true
		}
		return "{}", true
	case "cursor":
		if event == "started" {
			return `{"continue":true}`, true
		}
		return "{}", true
	case "gemini":
		return "{}", true
	}
	return "", false
}
