package main

import "strings"

type ceCommand interface {
	apply(config map[string]string)
	undo(config map[string]string)
}

// The kinds of edit differ only in when they're refused and how they change the value.
type ceKind interface {
	refused(config map[string]string, key, val string) bool
	change(config map[string]string, key, val string)
}

type cePut struct{}

func (cePut) refused(config map[string]string, key, val string) bool {
	current, found := config[key]
	return found && current == val
}
func (cePut) change(config map[string]string, key, val string) { config[key] = val }

type ceRemove struct{}

func (ceRemove) refused(config map[string]string, key, val string) bool {
	_, found := config[key]
	return !found
}
func (ceRemove) change(config map[string]string, key, val string) { delete(config, key) }

type ceAppend struct{}

func (ceAppend) refused(config map[string]string, key, val string) bool {
	_, found := config[key]
	return !found || val == ""
}
func (ceAppend) change(config map[string]string, key, val string) { config[key] += val }

var ceOps = map[string]ceKind{"put": cePut{}, "remove": ceRemove{}, "append": ceAppend{}}

// A command: one edit to one key. Doing it remembers the key's value before, so undoing
// it is the same for every kind of edit.
type ceEdit struct {
	kind     ceKind
	key, val string
	before   *string
}

func (e *ceEdit) refused(config map[string]string) bool {
	return e.kind.refused(config, e.key, e.val)
}

func (e *ceEdit) apply(config map[string]string) {
	e.before = nil
	if current, found := config[e.key]; found {
		e.before = &current
	}
	e.kind.change(config, e.key, e.val)
}

func (e *ceEdit) undo(config map[string]string) {
	if e.before == nil {
		delete(config, e.key)
	} else {
		config[e.key] = *e.before
	}
}

// Several edits done and undone as one command: undone in reverse order.
type ceBatch struct{ edits []*ceEdit }

func (b *ceBatch) apply(config map[string]string) {
	for _, edit := range b.edits {
		edit.apply(config)
	}
}

func (b *ceBatch) undo(config map[string]string) {
	for i := len(b.edits) - 1; i >= 0; i-- {
		b.edits[i].undo(config)
	}
}

func ceMakeEdit(op, key, val string) *ceEdit {
	kind, known := ceOps[op]
	if !known || key == "" {
		panic("unknown op or empty key")
	}
	return &ceEdit{kind: kind, key: key, val: val}
}

// Every change is a command kept on a history, so undo and redo never need to know
// which kind of edit they're reversing.
type ConfigEditor struct {
	config map[string]string
	done   []ceCommand
	undone []ceCommand
}

func NewConfigEditor() *ConfigEditor {
	return &ConfigEditor{config: map[string]string{}}
}

func (c *ConfigEditor) apply(op string, key string, val string) bool {
	edit := ceMakeEdit(op, key, val)
	if edit.refused(c.config) {
		return false
	}
	edit.apply(c.config)
	c.record(edit)
	return true
}

func (c *ConfigEditor) undo() bool {
	if len(c.done) == 0 {
		return false
	}
	command := c.done[len(c.done)-1]
	c.done = c.done[:len(c.done)-1]
	command.undo(c.config)
	c.undone = append(c.undone, command)
	return true
}

func (c *ConfigEditor) redo() bool {
	if len(c.undone) == 0 {
		return false
	}
	command := c.undone[len(c.undone)-1]
	c.undone = c.undone[:len(c.undone)-1]
	command.apply(c.config)
	c.done = append(c.done, command)
	return true
}

func (c *ConfigEditor) view() map[string]string {
	out := map[string]string{}
	for key, val := range c.config {
		out[key] = val
	}
	return out
}

// The extension round: several edits as one command.
func (c *ConfigEditor) batch(ops []string) bool {
	edits := []*ceEdit{}
	for _, entry := range ops {
		fields := strings.SplitN(entry, " ", 3)
		if len(fields) != 3 {
			panic("not <op> <key> <val>")
		}
		edits = append(edits, ceMakeEdit(fields[0], fields[1], fields[2]))
	}
	applied := []*ceEdit{}
	for _, edit := range edits {
		if edit.refused(c.config) {
			continue
		}
		edit.apply(c.config)
		applied = append(applied, edit)
	}
	if len(applied) == 0 {
		return false
	}
	c.record(&ceBatch{edits: applied})
	return true
}

func (c *ConfigEditor) record(command ceCommand) {
	c.done = append(c.done, command)
	c.undone = nil
}
