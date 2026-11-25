"use strict";

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// A component: a rule (a leaf) or a group (a composite). Callers evaluate, count and mute
// either the same way, without asking which one they hold. Subclasses give firing(metrics,
// out), which adds the paths of their unmuted rules that fire, and count().
class AlertNode {
  constructor(name, parent) {
    this.name = name;
    this.parent = parent;
    this.muted = false;
  }

  path() {
    if (this.parent === null) return "/";
    const above = this.parent.path();
    return above === "/" ? `/${this.name}` : `${above}/${this.name}`;
  }
}

class Rule extends AlertNode {
  constructor(name, parent, metric, threshold) {
    super(name, parent);
    this.metric = metric;
    this.threshold = threshold;
  }

  firing(metrics, out) {
    const value = metrics.get(this.metric);
    if (!this.muted && value !== undefined && value > this.threshold)
      out.push(this.path());
  }

  count() {
    return 1;
  }
}

class Group extends AlertNode {
  constructor(name, parent) {
    super(name, parent);
    this.children = new Map();
  }

  firing(metrics, out) {
    // A muted group silences everything under it, whatever their own flags say.
    if (!this.muted)
      for (const child of this.children.values()) child.firing(metrics, out);
  }

  count() {
    let total = 0;
    for (const child of this.children.values()) total += child.count();
    return total;
  }
}

function checkName(name) {
  if (name === "" || name.includes("/"))
    throw new RangeError("a name is non-empty and has no slash");
}

class AlertTree {
  constructor() {
    this.root = new Group("", null);
  }

  group(parent, name) {
    const at = this.groupAt(parent);
    checkName(name);
    return this.attach(at, name, () => new Group(name, at));
  }

  rule(parent, name, metric, threshold) {
    const at = this.groupAt(parent);
    checkName(name);
    if (metric === "") throw new RangeError("empty metric");
    return this.attach(at, name, () => new Rule(name, at, metric, threshold));
  }

  mute(node, on) {
    const found = this.find(node);
    if (found.muted === on) return false;
    found.muted = on;
    return true;
  }

  firing(metrics) {
    const out = [];
    this.root.firing(new Map(Object.entries(metrics)), out);
    return out.sort(byCode);
  }

  count(node) {
    return this.find(node).count();
  }

  // The extension round: moving a subtree, with its mutes.
  moveNode(node, parent) {
    const moving = this.find(node);
    const to = this.groupAt(parent);
    if (moving.parent === null)
      throw new RangeError("the root stays where it is");
    // A group can't go under itself or anything below it: that would cut it off.
    const inside = `${to.path()}/`.startsWith(`${moving.path()}/`);
    if (inside || to.children.has(moving.name)) return false;
    moving.parent.children.delete(moving.name);
    moving.parent = to;
    to.children.set(moving.name, moving);
    return true;
  }

  attach(at, name, make) {
    if (at.children.has(name)) return false;
    at.children.set(name, make());
    return true;
  }

  find(path) {
    if (path === "/") return this.root;
    if (!path.startsWith("/"))
      throw new RangeError("a path starts with a slash");
    let at = this.root;
    for (const part of path.slice(1).split("/")) {
      if (!(at instanceof Group) || !at.children.has(part))
        throw new RangeError("no such node");
      at = at.children.get(part);
    }
    return at;
  }

  groupAt(path) {
    const found = this.find(path);
    if (!(found instanceof Group))
      throw new RangeError("a rule has no children");
    return found;
  }
}

module.exports = { AlertTree };
