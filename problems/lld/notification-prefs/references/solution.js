"use strict";

const CHANNELS = ["email", "push", "sms"]; // sorted

function check(user, channel) {
  if (user === "") throw new RangeError("a user is not empty");
  if (channel !== undefined && !CHANNELS.includes(channel))
    throw new RangeError("unknown channel");
}

function checkHour(hour) {
  if (hour < 0 || hour > 23) throw new RangeError("an hour is from 0 to 23");
}

// When a user doesn't want to be disturbed; knows nothing about channels. The same
// start and end is an empty window.
class QuietHours {
  #start;
  #end;

  constructor(start, end) {
    this.#start = start;
    this.#end = end;
  }

  contains(hour) {
    if (this.#start <= this.#end)
      return hour >= this.#start && hour < this.#end;
    return hour >= this.#start || hour < this.#end; // wraps past midnight
  }
}

// What one user chose. It answers questions about itself and never routes.
class Preferences {
  #optedOut = new Set();
  #quiet = null;
  #digested = new Set();
  #held = new Map(); // channel -> messages held for the digest

  optOut(channel) {
    this.#optedOut.add(channel);
    this.#held.delete(channel);
  }

  setQuiet(quiet) {
    this.#quiet = quiet;
  }

  receives(channel) {
    return !this.#optedOut.has(channel);
  }

  isQuiet(hour) {
    return this.#quiet !== null && this.#quiet.contains(hour);
  }

  useDigest(channel) {
    this.#digested.add(channel);
  }

  // Holds a message for the digest when the channel uses one.
  holds(channel) {
    const held = this.#digested.has(channel);
    if (held) this.#held.set(channel, (this.#held.get(channel) ?? 0) + 1);
    return held;
  }

  flush() {
    const total = [...this.#held.values()].reduce((sum, n) => sum + n, 0);
    this.#held.clear();
    return total;
  }
}

// Keeps preferences and decides delivery; sending is someone else's job.
class NotificationPrefs {
  #users = new Map();

  #prefs(user) {
    if (!this.#users.has(user)) this.#users.set(user, new Preferences());
    return this.#users.get(user);
  }

  optOut(user, channel) {
    check(user, channel);
    this.#prefs(user).optOut(channel);
  }

  quietHours(user, startHour, endHour) {
    check(user);
    checkHour(startHour);
    checkHour(endHour);
    this.#prefs(user).setQuiet(new QuietHours(startHour, endHour));
  }

  route(user, channel, hour, urgent) {
    check(user, channel);
    checkHour(hour);
    const prefs = this.#users.get(user);
    if (prefs === undefined) return true;
    if (!prefs.receives(channel)) return false;
    if (urgent) return true;
    return !prefs.holds(channel) && !prefs.isQuiet(hour);
  }

  channels(user) {
    check(user);
    const prefs = this.#users.get(user);
    return CHANNELS.filter((c) => prefs === undefined || prefs.receives(c));
  }

  // The extension round: non-urgent messages on a digest channel wait for the digest.
  digest(user, channel) {
    check(user, channel);
    this.#prefs(user).useDigest(channel);
  }

  flushDigest(user) {
    check(user);
    return this.#users.get(user)?.flush() ?? 0;
  }
}

module.exports = { NotificationPrefs };
