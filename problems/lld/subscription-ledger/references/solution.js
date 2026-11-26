"use strict";

const MAX_TIER = 100;
const MAX_PAUSE_MS = 1_000_000_000;
const MAX_MS = 1_000_000_000_000;
const MAX_EVERY = 10_000;

// A state is { status, tier, pausedUntil }, never changed once made, so a snapshot (a
// memento) is just a reference to one; null stands for a subscription not created yet.
function shown(state, now) {
  if (state === null) return "none";
  if (state.status === "active" && now < state.pausedUntil)
    return `paused:${String(state.tier)}`;
  return `${state.status}:${String(state.tier)}`;
}

function changed(s, change) {
  if (s === null) throw new Error("only created comes first");
  return { ...s, ...change };
}

// What each event does to a state, by its kind.
const APPLY = new Map([
  [
    "created",
    (_s, e) => ({ status: "active", tier: e.arg, pausedUntil: e.at }),
  ],
  ["upgraded", (s, e) => changed(s, { tier: e.arg })],
  ["paused", (s, e) => changed(s, { pausedUntil: e.at + e.arg })],
  ["cancelled", (s) => changed(s, { status: "cancelled" })],
]);

function apply(kind, s, e) {
  const fn = APPLY.get(kind);
  if (fn === undefined) throw new Error("no such event");
  return fn(s, e);
}

const running = (s, now) => shown(s, now).startsWith("active:");

// A request: its argument's range, and the rule it's checked by against the current
// state. If it's allowed, it becomes an event of `kind`.
class Command {
  constructor(kind, low, high, allowed) {
    this.kind = kind;
    this.low = low;
    this.high = high;
    this.allowed = allowed;
  }

  valid(arg) {
    return this.low <= arg && arg <= this.high;
  }
}

const COMMANDS = new Map([
  ["create", new Command("created", 1, MAX_TIER, (s) => s === null)],
  [
    "upgrade",
    new Command(
      "upgraded",
      1,
      MAX_TIER,
      (s, arg, now) => running(s, now) && s !== null && arg > s.tier,
    ),
  ],
  [
    "pause",
    new Command("paused", 1, MAX_PAUSE_MS, (s, _arg, now) => running(s, now)),
  ],
  [
    "cancel",
    new Command("cancelled", 0, 0, (s) => s !== null && s.status === "active"),
  ],
]);

// One subscription's events, its current state, and snapshots: (events covered, state
// after them).
class Stream {
  events = [];
  current = null;
  snapshots = [];
}

class SubscriptionLedger {
  streams = new Map();
  every = null;
  replayed = 0;
  last = 0;
  // An upcaster: an old event name and the newer name it's read under.
  renamed = new Map();
  kinds = new Map([...APPLY.keys()].map((k) => [k, k])); // current name -> kind
  handle(command, sub, arg, nowMs) {
    const found = COMMANDS.get(command);
    if (found === undefined || sub === "" || !found.valid(arg))
      throw new RangeError("an unknown command, an empty sub or a bad arg");
    if (nowMs < this.last || nowMs > MAX_MS)
      throw new RangeError("time runs forward, up to 10^12");
    this.last = nowMs;
    let stream = this.streams.get(sub);
    if (stream === undefined) {
      stream = new Stream();
      this.streams.set(sub, stream);
    }
    if (!found.allowed(stream.current, arg, nowMs)) return false;
    const event = { at: nowMs, name: this.nameOf(found.kind), arg };
    stream.events.push(event);
    const state = apply(found.kind, stream.current, event);
    stream.current = state;
    if (this.every !== null && stream.events.length % this.every === 0)
      stream.snapshots.push({ count: stream.events.length, state });
    return true;
  }

  events(sub) {
    return this.stream(sub).events.map(
      (e) => `${String(e.at)}:${this.read(e.name)}:${String(e.arg)}`,
    );
  }

  stateAt(sub, nowMs) {
    const stream = this.stream(sub);
    if (nowMs < 0 || nowMs > MAX_MS)
      throw new RangeError("a time runs from 0 to 10^12");
    let covered = 0;
    let state = null;
    for (const snapshot of stream.snapshots) {
      const last = stream.events[snapshot.count - 1];
      if (last !== undefined && last.at <= nowMs) {
        covered = snapshot.count;
        state = snapshot.state;
      }
    }
    for (const event of stream.events.slice(covered)) {
      if (event.at > nowMs) break;
      state = apply(this.kinds.get(this.read(event.name)) ?? "", state, event);
      this.replayed += 1;
    }
    return shown(state, nowMs);
  }

  snapshotEvery(n) {
    if (n < 1 || n > MAX_EVERY) throw new RangeError("n runs from 1 to 10^4");
    this.every = n;
  }

  replays() {
    return this.replayed;
  }

  // The extension round: old events read under a new schema name.
  upcast(eventName, newName) {
    const kind = this.kinds.get(eventName);
    if (kind === undefined || !/^[A-Za-z0-9]+$/.test(newName))
      throw new RangeError("not a current name, or a bad new name");
    if (this.kinds.has(newName) || this.renamed.has(newName))
      throw new RangeError("a name is never used twice");
    this.renamed.set(eventName, newName);
    this.kinds.delete(eventName);
    this.kinds.set(newName, kind);
  }

  nameOf(kind) {
    for (const [name, k] of this.kinds) if (k === kind) return name;
    throw new Error("every kind has a name");
  }

  read(name) {
    // Each name is renamed at most once and never reused, so this ends.
    let current = name;
    for (let i = 0; i < this.renamed.size; i++)
      current = this.renamed.get(current) ?? current;
    return current;
  }

  stream(sub) {
    if (sub === "") throw new RangeError("an empty sub");
    return this.streams.get(sub) ?? new Stream();
  }
}

module.exports = { SubscriptionLedger };
