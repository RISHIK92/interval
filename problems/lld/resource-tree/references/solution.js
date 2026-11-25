"use strict";

const PARENT_KIND = new Map([
  ["folder", "organization"],
  ["project", "folder"],
  ["resource", "project"],
]);

function named(...names) {
  if (names.includes(""))
    throw new RangeError("names, kinds, roles and members are not empty");
}

// Nodes compose: each holds its children, and removing one takes its subtree. Grants
// associate a member with a node by name; members are never nodes.
class ResourceTree {
  #org;
  #nodes = new Map();

  constructor(org) {
    named(org);
    this.#org = org;
    this.#nodes.set(org, ResourceTree.#node("organization", null));
  }

  static #node(kind, parent) {
    return {
      kind,
      parent,
      children: new Set(),
      grants: new Set(),
      denies: new Set(),
    };
  }

  #get(node) {
    named(node);
    const found = this.#nodes.get(node);
    if (found === undefined) throw new RangeError("unknown node");
    return found;
  }

  #fits(kind, parent) {
    return PARENT_KIND.get(kind) === this.#nodes.get(parent).kind;
  }

  addNode(parent, node, kind) {
    named(parent, node, kind);
    if (!PARENT_KIND.has(kind)) throw new RangeError("unknown kind");
    if (
      !this.#nodes.has(parent) ||
      this.#nodes.has(node) ||
      !this.#fits(kind, parent)
    )
      return false;
    this.#nodes.set(node, ResourceTree.#node(kind, parent));
    this.#nodes.get(parent).children.add(node);
    return true;
  }

  attach(node, role, member) {
    named(role, member);
    this.#get(node).grants.add(JSON.stringify([role, member]));
  }

  can(member, role, node) {
    named(member, role);
    const key = JSON.stringify([role, member]);
    let granted = false;
    for (
      let at = this.#get(node);
      at !== undefined;
      at = this.#nodes.get(at.parent)
    ) {
      if (at.denies.has(key)) return false;
      if (at.grants.has(key)) granted = true;
    }
    return granted;
  }

  move(node, parent) {
    named(node, parent);
    const moving = this.#nodes.get(node);
    if (moving === undefined || !this.#nodes.has(parent) || node === this.#org)
      return false;
    if (!this.#fits(moving.kind, parent)) return false;
    this.#nodes.get(moving.parent).children.delete(node);
    this.#nodes.get(parent).children.add(node);
    moving.parent = parent;
    return true;
  }

  remove(node) {
    const found = this.#get(node);
    if (node === this.#org)
      throw new RangeError("the organization can't be removed");
    this.#nodes.get(found.parent).children.delete(node);
    return this.#drop(node);
  }

  #drop(node) {
    let count = 1;
    for (const child of this.#nodes.get(node).children)
      count += this.#drop(child);
    this.#nodes.delete(node);
    return count;
  }

  // The extension round: a deny below or above overrides every grant.
  deny(node, role, member) {
    named(role, member);
    this.#get(node).denies.add(JSON.stringify([role, member]));
  }
}

module.exports = { ResourceTree };
