"use strict";

// Which actions each role may take: the one table a new role is added to.
const ROLES = new Map([
  ["viewer", new Set(["read"])],
  ["operator", new Set(["read", "suspend", "restore"])],
  ["admin", new Set(["read", "suspend", "restore", "delete"])],
]);
const ACTIONS = new Set(["read", "suspend", "restore", "delete"]);

function given(value) {
  if (value === "") throw new RangeError("empty");
}

// The real subject. It does whatever it's asked and knows nothing about roles. The proxy
// below answers the same handle(user, action, target).
class RealAdminApi {
  constructor() {
    this.calls = 0;
    this.suspended = new Set();
    this.deleted = new Set();
  }

  handle(user, action, target) {
    this.calls += 1;
    if (this.deleted.has(target)) return "404";
    if (action === "suspend") {
      if (this.suspended.has(target)) return "409";
      this.suspended.add(target);
    } else if (action === "restore") {
      if (!this.suspended.has(target)) return "409";
      this.suspended.delete(target);
    } else if (action === "delete") {
      this.deleted.add(target);
    }
    return "200";
  }
}

// A protection proxy: the same call as the real API, but it decides first whether the
// call may go through, and writes every attempt down. A call it stops never reaches the
// real API, which the API's own call count shows.
class AdminProxy {
  constructor() {
    this.api = new RealAdminApi();
    this.roles = new Map();
    this.log = [];
    this.glass = new Set();
  }

  grant(user, role) {
    given(user);
    if (!ROLES.has(role)) throw new RangeError("unknown role");
    if (!this.roles.has(user)) this.roles.set(user, new Set());
    this.roles.get(user).add(role);
  }

  handle(user, action, target) {
    // Who you are (authentication) comes before what you may do (authorization).
    const roles = this.roles.get(user);
    if (roles === undefined) return "401";
    if (
      this.glass.has(user) ||
      [...roles].some((role) => ROLES.get(role).has(action))
    )
      return this.api.handle(user, action, target);
    return "403";
  }

  invoke(user, action, target) {
    given(user);
    if (!ACTIONS.has(action)) throw new RangeError("unknown action");
    given(target);
    const status = this.handle(user, action, target);
    const line = `${user} ${action} ${target} ${status}`;
    this.log.push(this.glass.has(user) ? `${line} break-glass` : line);
    return `${status} ${action} ${target}`;
  }

  audit() {
    return [...this.log];
  }

  realCalls() {
    return this.api.calls;
  }

  // The extension round: emergency access, marked in the audit.
  breakGlass(user) {
    this.known(user);
    if (this.glass.has(user)) return false;
    this.glass.add(user);
    return true;
  }

  endBreakGlass(user) {
    this.known(user);
    return this.glass.delete(user);
  }

  known(user) {
    if (!this.roles.has(user))
      throw new RangeError("break-glass is for users with a grant");
  }
}

module.exports = { AdminProxy };
