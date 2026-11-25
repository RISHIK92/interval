"use strict";

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function given(value) {
  if (value === "") throw new RangeError("empty");
}

// A component: a service (a leaf) or a unit (a composite). Anyone asking for a total asks
// the node, whichever it is. Subclasses give total() and children().
class CostNode {
  constructor(name, parent) {
    this.name = name;
    this.parent = parent;
    this.shared = 0; // cents allocated to this node from above (the extension)
  }
}

class Service extends CostNode {
  constructor(name, parent, cents) {
    super(name, parent);
    this.cents = cents;
  }
  total() {
    return this.cents + this.shared;
  }
  children() {
    return [];
  }
}

class Unit extends CostNode {
  constructor(name, parent) {
    super(name, parent);
    this.members = new Map();
  }
  total() {
    let sum = this.shared;
    for (const child of this.members.values()) sum += child.total();
    return sum;
  }
  children() {
    return [...this.members.values()];
  }
  // Whether this unit is node itself or somewhere under it.
  within(node) {
    return this === node || (this.parent !== null && this.parent.within(node));
  }
}

class CostTree {
  constructor(root) {
    given(root);
    this.nodes = new Map([[root, new Unit(root, null)]]);
  }

  unit(parent, name) {
    const at = this.unitAt(parent);
    given(name);
    return this.attach(at, new Unit(name, at));
  }

  service(parent, name, cents) {
    const at = this.unitAt(parent);
    given(name);
    if (cents < 0) throw new RangeError("a cost is never negative");
    return this.attach(at, new Service(name, at, cents));
  }

  total(node) {
    return this.find(node).total();
  }

  move(node, parent) {
    const moving = this.find(node);
    const to = this.unitAt(parent);
    if (moving.parent === null)
      throw new RangeError("the root stays where it is");
    if (moving.parent === to || to.within(moving)) return false;
    moving.parent.members.delete(moving.name);
    moving.parent = to;
    to.members.set(moving.name, moving);
    return true;
  }

  top(node, n) {
    const found = this.find(node);
    if (n < 0) throw new RangeError("n is never negative");
    return found
      .children()
      .map((child) => ({ name: child.name, total: child.total() }))
      .sort((a, b) => b.total - a.total || byCode(a.name, b.name))
      .slice(0, n)
      .map((child) => `${child.name} ${child.total}`);
  }

  // The extension round: a cost shared by everything directly under a unit.
  sharedCost(node, cents) {
    const found = this.unitAt(node);
    if (cents < 0) throw new RangeError("a cost is never negative");
    const children = found.children().sort((a, b) => byCode(a.name, b.name));
    if (children.length === 0) throw new RangeError("nothing to share with");
    const each = Math.floor(cents / children.length);
    const extra = cents % children.length;
    children.forEach((child, i) => {
      child.shared += each + (i < extra ? 1 : 0);
    });
  }

  attach(at, node) {
    if (this.nodes.has(node.name)) return false;
    at.members.set(node.name, node);
    this.nodes.set(node.name, node);
    return true;
  }

  find(name) {
    const found = this.nodes.get(name);
    if (found === undefined) throw new RangeError("no such node");
    return found;
  }

  unitAt(name) {
    const found = this.find(name);
    if (!(found instanceof Unit))
      throw new RangeError("a service has nothing under it");
    return found;
  }
}

module.exports = { CostTree };
