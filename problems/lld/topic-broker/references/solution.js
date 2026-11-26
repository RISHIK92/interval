"use strict";

const MAX_POLL = 100;
const MAX_NACKS = 3;
const IN_FLIGHT = "in-flight";
const DONE = "done";
const DEAD = "dead";

function checkNamed(...names) {
  if (names.includes("")) throw new RangeError("an empty name or payload");
}

function checkOffset(offset) {
  if (offset < 0) throw new RangeError("an offset is at least 0");
}

// A consumer group: its members share one position in the topic. It covers the offsets
// from `start`; each one below `next` is in `state` or waiting in `again`.
class Group {
  consumers = new Set();
  again = []; // offsets to deliver again, ascending
  state = new Map();
  nacks = new Map();
  dead = [];

  constructor(topic, start) {
    this.topic = topic;
    this.start = start;
    this.next = start;
  }

  take(most, end) {
    const taken = this.again.splice(0, most);
    // Redeliveries are always below `next`, so this keeps offset order.
    const fresh = Math.min(most - taken.length, end - this.next);
    for (let i = 0; i < fresh; i++) taken.push(this.next + i);
    this.next += fresh;
    for (const offset of taken) this.state.set(offset, IN_FLIGHT);
    return taken;
  }

  settle(offset, acked) {
    if (this.state.get(offset) !== IN_FLIGHT) return false;
    if (acked) {
      this.state.set(offset, DONE);
      return true;
    }
    const nacks = (this.nacks.get(offset) ?? 0) + 1;
    this.nacks.set(offset, nacks);
    if (nacks === MAX_NACKS) {
      this.state.set(offset, DEAD);
      this.dead.push(offset);
    } else {
      this.toAgain(offset);
    }
    return true;
  }

  rewind(offset) {
    let made = 0;
    for (let o = offset; o < this.next; o++) {
      const state = this.state.get(o);
      if (o < this.start || state === IN_FLIGHT || state === DONE) {
        this.nacks.delete(o);
        this.toAgain(o);
        made += 1;
      }
    }
    this.start = Math.min(this.start, offset);
    return made;
  }

  toAgain(offset) {
    this.state.delete(offset);
    const at = this.again.findIndex((o) => o > offset);
    this.again.splice(at === -1 ? this.again.length : at, 0, offset);
  }
}

// The mediator: publishers and consumer groups only ever talk to it, never to each other.
class Broker {
  topics = new Map();
  groups = new Map();

  publishMsg(topic, payload) {
    checkNamed(topic, payload);
    let messages = this.topics.get(topic);
    if (messages === undefined) {
      messages = [];
      this.topics.set(topic, messages);
    }
    messages.push(payload);
    return messages.length - 1;
  }

  subscribeGroup(group, topic, consumer) {
    checkNamed(group, topic, consumer);
    let found = this.groups.get(group);
    if (found === undefined) {
      found = new Group(topic, this.topics.get(topic)?.length ?? 0);
      this.groups.set(group, found);
    } else if (found.topic !== topic) {
      throw new RangeError("a group reads one topic");
    }
    found.consumers.add(consumer);
  }

  poll(group, consumer, max) {
    const found = this.findGroup(group);
    if (!found.consumers.has(consumer) || max < 1 || max > MAX_POLL)
      throw new RangeError("not a member, or max outside 1 to 100");
    const end = this.topics.get(found.topic)?.length ?? 0;
    return found.take(max, end).map((o) => this.shown(found, o));
  }

  ack(group, offset) {
    const found = this.findGroup(group);
    checkOffset(offset);
    return found.settle(offset, true);
  }

  nack(group, offset) {
    const found = this.findGroup(group);
    checkOffset(offset);
    return found.settle(offset, false);
  }

  deadLetters(group) {
    const found = this.findGroup(group);
    return found.dead.map((o) => this.shown(found, o));
  }

  // The extension round: rewind a group to an earlier offset.
  replayFrom(group, offset) {
    const found = this.findGroup(group);
    checkOffset(offset);
    return found.rewind(offset);
  }

  shown(group, offset) {
    return `${String(offset)}:${this.topics.get(group.topic)?.[offset] ?? ""}`;
  }

  findGroup(group) {
    const found = this.groups.get(group);
    if (found === undefined) throw new RangeError("no such group");
    return found;
  }
}

module.exports = { Broker };
