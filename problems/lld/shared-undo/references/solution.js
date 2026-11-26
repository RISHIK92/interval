"use strict";

function checkName(text) {
  if (text === "") throw new RangeError("an empty name or value");
}

function checkUser(user) {
  checkName(user);
  if (user.includes(":")) throw new RangeError("a user name has no colon");
}

// A command that remembers the key's value before it ran (its memento), so it can be
// undone and redone. `at` counts its key's writes up to the one that last applied it: the
// edit, an undo or a redo.
class Edit {
  constructor(user, key, before, after) {
    this.user = user;
    this.key = key;
    this.before = before;
    this.after = after;
    this.at = 0;
  }
}

class SharedDoc {
  constructor() {
    this.values = new Map();
    this.writes = new Map(); // key -> [{ user, entry }]
    this.undos = new Map();
    this.redos = new Map();
  }

  edit(user, key, val) {
    checkUser(user);
    checkName(key);
    checkName(val);
    const command = new Edit(user, key, this.values.get(key) ?? null, val);
    this.write(command, "edit", val);
    if (!this.undos.has(user)) this.undos.set(user, []);
    this.undos.get(user).push(command);
    this.redos.set(user, []);
  }

  undo(user) {
    return this.undoLast(user, false);
  }

  redo(user) {
    checkUser(user);
    const stack = this.redos.get(user) ?? [];
    const command = stack.at(-1);
    if (command === undefined || this.conflicts(command)) return false;
    stack.pop();
    this.write(command, "redo", command.after);
    this.undos.get(user).push(command);
    return true;
  }

  value(key) {
    checkName(key);
    return this.values.get(key) ?? null;
  }

  history(key) {
    checkName(key);
    return (this.writes.get(key) ?? []).map((w) => w.entry);
  }

  // The extension round: an undo that goes through despite a conflict.
  undoForce(user) {
    return this.undoLast(user, true);
  }

  undoLast(user, force) {
    checkUser(user);
    const stack = this.undos.get(user) ?? [];
    const command = stack.at(-1);
    if (command === undefined) return false;
    let action = "undo";
    if (this.conflicts(command)) {
      if (!force) return false;
      action = "force";
    }
    stack.pop();
    this.write(command, action, command.before);
    this.redos.get(user).push(command);
    return true;
  }

  // Someone else wrote the key after the command last took effect.
  conflicts(command) {
    const later = this.writes.get(command.key).slice(command.at);
    return later.some((w) => w.user !== command.user);
  }

  write(command, action, val) {
    if (val === null) this.values.delete(command.key);
    else this.values.set(command.key, val);
    if (!this.writes.has(command.key)) this.writes.set(command.key, []);
    const writes = this.writes.get(command.key);
    writes.push({
      user: command.user,
      entry: `${action}:${command.user}:${val ?? ""}`,
    });
    command.at = writes.length;
  }
}

module.exports = { SharedDoc };
