package main

import (
	"sort"
	"strconv"
	"strings"
)

const busMaxReplicas = 1000

type busService struct {
	replicas int64
	paused   bool
}

// A command object: it knows how to run itself and how to take itself back. Running
// reports whether anything changed: a command that changed nothing has nothing to undo.
type busCommand interface {
	service() string
	run(target *busService) bool
	undo(target *busService)
}

type scaleCommand struct {
	name           string
	target, before int64
}

func (c *scaleCommand) service() string { return c.name }

func (c *scaleCommand) run(target *busService) bool {
	c.before = target.replicas
	target.replicas = c.target
	return c.before != c.target
}

func (c *scaleCommand) undo(target *busService) { target.replicas = c.before }

type pauseCommand struct{ name string }

func (c *pauseCommand) service() string { return c.name }

func (c *pauseCommand) run(target *busService) bool {
	changed := !target.paused
	target.paused = true
	return changed
}

func (c *pauseCommand) undo(target *busService) { target.paused = false }

type resumeCommand struct{ name string }

func (c *resumeCommand) service() string { return c.name }

func (c *resumeCommand) run(target *busService) bool {
	changed := target.paused
	target.paused = false
	return changed
}

func (c *resumeCommand) undo(target *busService) { target.paused = true }

func busCount(text string) (int64, bool) {
	if text == "" || len(text) > 4 || (len(text) > 1 && text[0] == '0') {
		return 0, false
	}
	for _, c := range text {
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	n, _ := strconv.ParseInt(text, 10, 64)
	return n, n <= busMaxReplicas
}

func parseBusCommand(command string, arg string) busCommand {
	if command == "scale" {
		name, count, found := strings.Cut(arg, "=")
		n, ok := busCount(count)
		if !found || name == "" || !ok {
			panic("scale takes <service>=<0 to 1000>")
		}
		return &scaleCommand{name: name, target: n}
	}
	if arg == "" || strings.Contains(arg, "=") {
		panic("a service name")
	}
	if command == "pause" {
		return &pauseCommand{arg}
	}
	if command == "resume" {
		return &resumeCommand{arg}
	}
	panic("unknown command")
}

type busEntry struct {
	id, line string
	command  busCommand
	atMs     int64
}

type CommandBus struct {
	services  map[string]*busService
	ids       map[string]bool
	queue     []busEntry
	scheduled []busEntry
	done      []busEntry
	history   []string
}

func NewCommandBus() *CommandBus {
	return &CommandBus{services: map[string]*busService{}, ids: map[string]bool{}}
}

func (b *CommandBus) accept(id, command, arg string, atMs int64) *busEntry {
	if id == "" {
		panic("an empty id")
	}
	parsed := parseBusCommand(command, arg)
	if b.ids[id] {
		return nil
	}
	b.ids[id] = true
	return &busEntry{id: id, line: command + " " + arg, command: parsed, atMs: atMs}
}

func (b *CommandBus) target(name string) *busService {
	found, ok := b.services[name]
	if !ok {
		found = &busService{}
		b.services[name] = found
	}
	return found
}

func (b *CommandBus) run(entry busEntry) string {
	line := entry.id + ": skipped"
	if entry.command.run(b.target(entry.command.service())) {
		b.done = append(b.done, entry)
		line = entry.id + ": " + entry.line
	}
	b.history = append(b.history, line)
	return line
}

func (b *CommandBus) submit(id string, command string, arg string) bool {
	entry := b.accept(id, command, arg, 0)
	if entry == nil {
		return false
	}
	b.queue = append(b.queue, *entry)
	return true
}

func (b *CommandBus) execute() []string {
	ran := b.queue
	b.queue = nil
	lines := []string{}
	for _, entry := range ran {
		lines = append(lines, b.run(entry))
	}
	return lines
}

func (b *CommandBus) undoLast() *string {
	if len(b.done) == 0 {
		return nil
	}
	entry := b.done[len(b.done)-1]
	b.done = b.done[:len(b.done)-1]
	entry.command.undo(b.target(entry.command.service()))
	b.history = append(b.history, entry.id+": undone")
	return &entry.id
}

func (b *CommandBus) replicas(service string) int64 {
	if service == "" {
		panic("an empty service")
	}
	found, ok := b.services[service]
	if !ok || found.paused {
		return 0
	}
	return found.replicas
}

func (b *CommandBus) log() []string {
	return append([]string{}, b.history...)
}

// The extension round: commands that wait for their time, sharing the ids and the undo
// stack.
func (b *CommandBus) schedule(id string, command string, arg string, atMs int64) bool {
	if atMs < 0 {
		panic("a negative time")
	}
	entry := b.accept(id, command, arg, atMs)
	if entry == nil {
		return false
	}
	b.scheduled = append(b.scheduled, *entry)
	return true
}

func (b *CommandBus) executeDue(nowMs int64) []string {
	if nowMs < 0 {
		panic("a negative time")
	}
	due, later := []busEntry{}, []busEntry{}
	for _, entry := range b.scheduled {
		if entry.atMs <= nowMs {
			due = append(due, entry)
		} else {
			later = append(later, entry)
		}
	}
	b.scheduled = later
	// A stable sort: commands due at the same time run in the order they were scheduled.
	sort.SliceStable(due, func(i, j int) bool { return due[i].atMs < due[j].atMs })
	lines := []string{}
	for _, entry := range due {
		lines = append(lines, b.run(entry))
	}
	return lines
}
