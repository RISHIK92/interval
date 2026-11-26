"use strict";

const MAX_REPLICAS = 1000;

// A command object: it knows how to run itself and how to take itself back. Running
// reports whether anything changed: a command that changed nothing has nothing to undo.
class Scale {
  #target;
  #before = 0;

  constructor(service, target) {
    this.service = service;
    this.#target = target;
  }

  run(service) {
    this.#before = service.replicas;
    service.replicas = this.#target;
    return this.#before !== this.#target;
  }

  undo(service) {
    service.replicas = this.#before;
  }
}

class Pause {
  constructor(service) {
    this.service = service;
  }

  run(service) {
    const changed = !service.paused;
    service.paused = true;
    return changed;
  }

  undo(service) {
    service.paused = false;
  }
}

class Resume {
  constructor(service) {
    this.service = service;
  }

  run(service) {
    const changed = service.paused;
    service.paused = false;
    return changed;
  }

  undo(service) {
    service.paused = true;
  }
}

function parse(command, arg) {
  if (command === "scale") {
    const at = arg.indexOf("=");
    const name = at < 0 ? "" : arg.slice(0, at);
    const count = at < 0 ? "" : arg.slice(at + 1);
    if (
      name === "" ||
      !/^(0|[1-9][0-9]{0,3})$/.test(count) ||
      Number(count) > MAX_REPLICAS
    )
      throw new RangeError("scale takes <service>=<0 to 1000>");
    return new Scale(name, Number(count));
  }
  if (arg === "" || arg.includes("=")) throw new RangeError("a service name");
  if (command === "pause") return new Pause(arg);
  if (command === "resume") return new Resume(arg);
  throw new RangeError("unknown command");
}

class CommandBus {
  #services = new Map();
  #ids = new Set();
  #queue = [];
  #scheduled = [];
  #done = [];
  #history = [];

  #accept(id, command, arg) {
    if (id === "") throw new RangeError("an empty id");
    const parsed = parse(command, arg);
    if (this.#ids.has(id)) return null;
    this.#ids.add(id);
    return { id, line: `${command} ${arg}`, command: parsed };
  }

  #run(entry) {
    const name = entry.command.service;
    if (!this.#services.has(name))
      this.#services.set(name, { replicas: 0, paused: false });
    let line = `${entry.id}: skipped`;
    if (entry.command.run(this.#services.get(name))) {
      this.#done.push(entry);
      line = `${entry.id}: ${entry.line}`;
    }
    this.#history.push(line);
    return line;
  }

  submit(id, command, arg) {
    const entry = this.#accept(id, command, arg);
    if (entry === null) return false;
    this.#queue.push(entry);
    return true;
  }

  execute() {
    const queue = this.#queue;
    this.#queue = [];
    return queue.map((entry) => this.#run(entry));
  }

  undoLast() {
    const entry = this.#done.pop();
    if (entry === undefined) return null;
    entry.command.undo(this.#services.get(entry.command.service));
    this.#history.push(`${entry.id}: undone`);
    return entry.id;
  }

  replicas(service) {
    if (service === "") throw new RangeError("an empty service");
    const found = this.#services.get(service);
    return found === undefined || found.paused ? 0 : found.replicas;
  }

  log() {
    return [...this.#history];
  }

  // The extension round: commands that wait for their time, sharing the ids and the
  // undo stack.
  schedule(id, command, arg, atMs) {
    if (atMs < 0) throw new RangeError("a negative time");
    const entry = this.#accept(id, command, arg);
    if (entry === null) return false;
    this.#scheduled.push({ ...entry, atMs });
    return true;
  }

  executeDue(nowMs) {
    if (nowMs < 0) throw new RangeError("a negative time");
    // A stable sort: commands due at the same time run in the order they were scheduled.
    const due = this.#scheduled
      .filter((entry) => entry.atMs <= nowMs)
      .sort((a, b) => a.atMs - b.atMs);
    this.#scheduled = this.#scheduled.filter((entry) => entry.atMs > nowMs);
    return due.map((entry) => this.#run(entry));
  }
}

module.exports = { CommandBus };
