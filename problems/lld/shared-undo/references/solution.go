package main

import "strings"

func checkName(text string) {
	if text == "" {
		panic("an empty name or value")
	}
}

func checkUser(user string) {
	checkName(user)
	if strings.Contains(user, ":") {
		panic("a user name has no colon")
	}
}

// A command that remembers the key's value before it ran (its memento), so it can be
// undone and redone. `at` counts its key's writes up to the one that last applied it: the
// edit, an undo or a redo.
type edit struct {
	user, key string
	before    *string
	after     string
	at        int
}

type write struct {
	user, entry string
}

type SharedDoc struct {
	values map[string]string
	writes map[string][]write
	undos  map[string][]*edit
	redos  map[string][]*edit
}

func NewSharedDoc() *SharedDoc {
	return &SharedDoc{values: map[string]string{}, writes: map[string][]write{}, undos: map[string][]*edit{}, redos: map[string][]*edit{}}
}

func (d *SharedDoc) edit(user string, key string, val string) {
	checkUser(user)
	checkName(key)
	checkName(val)
	var before *string
	if old, ok := d.values[key]; ok {
		before = &old
	}
	command := &edit{user: user, key: key, before: before, after: val}
	d.write(command, "edit", &command.after)
	d.undos[user] = append(d.undos[user], command)
	d.redos[user] = nil
}

func (d *SharedDoc) undo(user string) bool { return d.undoLast(user, false) }

func (d *SharedDoc) redo(user string) bool {
	checkUser(user)
	stack := d.redos[user]
	if len(stack) == 0 || d.conflicts(stack[len(stack)-1]) {
		return false
	}
	command := stack[len(stack)-1]
	d.redos[user] = stack[:len(stack)-1]
	d.write(command, "redo", &command.after)
	d.undos[user] = append(d.undos[user], command)
	return true
}

func (d *SharedDoc) value(key string) *string {
	checkName(key)
	if v, ok := d.values[key]; ok {
		return &v
	}
	return nil
}

func (d *SharedDoc) history(key string) []string {
	checkName(key)
	out := []string{}
	for _, w := range d.writes[key] {
		out = append(out, w.entry)
	}
	return out
}

// The extension round: an undo that goes through despite a conflict.
func (d *SharedDoc) undoForce(user string) bool { return d.undoLast(user, true) }

func (d *SharedDoc) undoLast(user string, force bool) bool {
	checkUser(user)
	stack := d.undos[user]
	if len(stack) == 0 {
		return false
	}
	command := stack[len(stack)-1]
	action := "undo"
	if d.conflicts(command) {
		if !force {
			return false
		}
		action = "force"
	}
	d.undos[user] = stack[:len(stack)-1]
	d.write(command, action, command.before)
	d.redos[user] = append(d.redos[user], command)
	return true
}

// Someone else wrote the key after the command last took effect.
func (d *SharedDoc) conflicts(command *edit) bool {
	for _, w := range d.writes[command.key][command.at:] {
		if w.user != command.user {
			return true
		}
	}
	return false
}

func (d *SharedDoc) write(command *edit, action string, val *string) {
	shown := ""
	if val == nil {
		delete(d.values, command.key)
	} else {
		d.values[command.key] = *val
		shown = *val
	}
	d.writes[command.key] = append(d.writes[command.key], write{command.user, action + ":" + command.user + ":" + shown})
	command.at = len(d.writes[command.key])
}
