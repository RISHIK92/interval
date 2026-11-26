"use strict";

// A command: one edit to one key. Doing it remembers the key's value before, so undoing
// it is the same for every kind of edit.
class Edit {
  #before = undefined;

  constructor(key, val) {
    this.key = key;
    this.val = val;
  }

  do(config) {
    this.#before = config.get(this.key);
    this.change(config);
  }

  undo(config) {
    if (this.#before === undefined) config.delete(this.key);
    else config.set(this.key, this.#before);
  }
}

class Put extends Edit {
  refused(config) {
    return config.get(this.key) === this.val;
  }

  change(config) {
    config.set(this.key, this.val);
  }
}

class Remove extends Edit {
  refused(config) {
    return !config.has(this.key);
  }

  change(config) {
    config.delete(this.key);
  }
}

class Append extends Edit {
  refused(config) {
    return !config.has(this.key) || this.val === "";
  }

  change(config) {
    config.set(this.key, config.get(this.key) + this.val);
  }
}

// Several edits done and undone as one command: undone in reverse order.
class Batch {
  #edits;

  constructor(edits) {
    this.#edits = edits;
  }

  do(config) {
    for (const edit of this.#edits) edit.do(config);
  }

  undo(config) {
    for (const edit of [...this.#edits].reverse()) edit.undo(config);
  }
}

const OPS = new Map([
  ["put", Put],
  ["remove", Remove],
  ["append", Append],
]);

function makeEdit(op, key, val) {
  const Kind = OPS.get(op);
  if (Kind === undefined || key === "")
    throw new RangeError("unknown op or empty key");
  return new Kind(key, val);
}

function parse(entry) {
  const first = entry.indexOf(" ");
  const second = first < 0 ? -1 : entry.indexOf(" ", first + 1);
  if (second < 0) throw new RangeError("not <op> <key> <val>");
  return makeEdit(
    entry.slice(0, first),
    entry.slice(first + 1, second),
    entry.slice(second + 1),
  );
}

// Every change is a command kept on a history, so undo and redo never need to know
// which kind of edit they're reversing.
class ConfigEditor {
  #config = new Map();
  #done = [];
  #undone = [];

  apply(op, key, val) {
    const edit = makeEdit(op, key, val);
    if (edit.refused(this.#config)) return false;
    edit.do(this.#config);
    this.#record(edit);
    return true;
  }

  undo() {
    const command = this.#done.pop();
    if (command === undefined) return false;
    command.undo(this.#config);
    this.#undone.push(command);
    return true;
  }

  redo() {
    const command = this.#undone.pop();
    if (command === undefined) return false;
    command.do(this.#config);
    this.#done.push(command);
    return true;
  }

  view() {
    return Object.fromEntries(this.#config);
  }

  // The extension round: several edits as one command.
  batch(ops) {
    const edits = ops.map(parse);
    const applied = [];
    for (const edit of edits) {
      if (edit.refused(this.#config)) continue;
      edit.do(this.#config);
      applied.push(edit);
    }
    if (applied.length === 0) return false;
    this.#record(new Batch(applied));
    return true;
  }

  #record(command) {
    this.#done.push(command);
    this.#undone = [];
  }
}

module.exports = { ConfigEditor };
