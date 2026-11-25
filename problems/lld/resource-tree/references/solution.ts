const PARENT_KIND = new Map<string, string>([
  ["folder", "organization"],
  ["project", "folder"],
  ["resource", "project"],
]);

type TreeNode = {
  kind: string;
  parent: string | null;
  children: Set<string>;
  grants: Set<string>;
  denies: Set<string>;
};

function named(...names: string[]): void {
  if (names.includes(""))
    throw new RangeError("names, kinds, roles and members are not empty");
}

function newNode(kind: string, parent: string | null): TreeNode {
  return {
    kind,
    parent,
    children: new Set(),
    grants: new Set(),
    denies: new Set(),
  };
}

// Nodes compose: each holds its children, and removing one takes its subtree. Grants
// associate a member with a node by name; members are never nodes.
export class ResourceTree {
  private readonly org: string;
  private readonly nodes = new Map<string, TreeNode>();

  constructor(org: string) {
    named(org);
    this.org = org;
    this.nodes.set(org, newNode("organization", null));
  }

  private get(node: string): TreeNode {
    named(node);
    const found = this.nodes.get(node);
    if (found === undefined) throw new RangeError("unknown node");
    return found;
  }

  private fits(kind: string, parent: TreeNode): boolean {
    return PARENT_KIND.get(kind) === parent.kind;
  }

  addNode(parent: string, node: string, kind: string): boolean {
    named(parent, node, kind);
    if (!PARENT_KIND.has(kind)) throw new RangeError("unknown kind");
    const holder = this.nodes.get(parent);
    if (
      holder === undefined ||
      this.nodes.has(node) ||
      !this.fits(kind, holder)
    )
      return false;
    this.nodes.set(node, newNode(kind, parent));
    holder.children.add(node);
    return true;
  }

  attach(node: string, role: string, member: string): void {
    named(role, member);
    this.get(node).grants.add(JSON.stringify([role, member]));
  }

  can(member: string, role: string, node: string): boolean {
    named(member, role);
    const key = JSON.stringify([role, member]);
    let granted = false;
    for (
      let at: TreeNode | undefined = this.get(node);
      at !== undefined;
      at = at.parent === null ? undefined : this.nodes.get(at.parent)
    ) {
      if (at.denies.has(key)) return false;
      if (at.grants.has(key)) granted = true;
    }
    return granted;
  }

  move(node: string, parent: string): boolean {
    named(node, parent);
    const moving = this.nodes.get(node);
    const holder = this.nodes.get(parent);
    if (moving === undefined || holder === undefined || moving.parent === null)
      return false;
    if (!this.fits(moving.kind, holder)) return false;
    this.nodes.get(moving.parent)?.children.delete(node);
    holder.children.add(node);
    moving.parent = parent;
    return true;
  }

  remove(node: string): number {
    const found = this.get(node);
    if (found.parent === null)
      throw new RangeError("the organization can't be removed");
    this.nodes.get(found.parent)?.children.delete(node);
    return this.drop(node);
  }

  private drop(node: string): number {
    let count = 1;
    for (const child of this.nodes.get(node)?.children ?? [])
      count += this.drop(child);
    this.nodes.delete(node);
    return count;
  }

  // The extension round: a deny below or above overrides every grant.
  deny(node: string, role: string, member: string): void {
    named(role, member);
    this.get(node).denies.add(JSON.stringify([role, member]));
  }
}
