// Which actions each role may take: the one table a new role is added to.
const ROLES = new Map<string, ReadonlySet<string>>([
  ["viewer", new Set(["read"])],
  ["operator", new Set(["read", "suspend", "restore"])],
  ["admin", new Set(["read", "suspend", "restore", "delete"])],
]);
const ACTIONS: ReadonlySet<string> = new Set([
  "read",
  "suspend",
  "restore",
  "delete",
]);

function given(value: string): void {
  if (value === "") throw new RangeError("empty");
}

// What callers see: the real API and its proxy answer the same call.
interface AdminApi {
  handle(user: string, action: string, target: string): string;
}

// The real subject. It does whatever it's asked and knows nothing about roles.
class RealAdminApi implements AdminApi {
  calls = 0;
  private readonly suspended = new Set<string>();
  private readonly deleted = new Set<string>();

  handle(_user: string, action: string, target: string): string {
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
export class AdminProxy implements AdminApi {
  private readonly api = new RealAdminApi();
  private readonly roles = new Map<string, Set<string>>();
  private readonly log: string[] = [];
  private readonly glass = new Set<string>();

  grant(user: string, role: string): void {
    given(user);
    if (!ROLES.has(role)) throw new RangeError("unknown role");
    const held = this.roles.get(user) ?? new Set<string>();
    held.add(role);
    this.roles.set(user, held);
  }

  handle(user: string, action: string, target: string): string {
    // Who you are (authentication) comes before what you may do (authorization).
    const roles = this.roles.get(user);
    if (roles === undefined) return "401";
    if (
      this.glass.has(user) ||
      [...roles].some((role) => ROLES.get(role)?.has(action) === true)
    )
      return this.api.handle(user, action, target);
    return "403";
  }

  invoke(user: string, action: string, target: string): string {
    given(user);
    if (!ACTIONS.has(action)) throw new RangeError("unknown action");
    given(target);
    const status = this.handle(user, action, target);
    const line = `${user} ${action} ${target} ${status}`;
    this.log.push(this.glass.has(user) ? `${line} break-glass` : line);
    return `${status} ${action} ${target}`;
  }

  audit(): string[] {
    return [...this.log];
  }

  realCalls(): number {
    return this.api.calls;
  }

  // The extension round: emergency access, marked in the audit.
  breakGlass(user: string): boolean {
    this.known(user);
    if (this.glass.has(user)) return false;
    this.glass.add(user);
    return true;
  }

  endBreakGlass(user: string): boolean {
    this.known(user);
    return this.glass.delete(user);
  }

  private known(user: string): void {
    if (!this.roles.has(user))
      throw new RangeError("break-glass is for users with a grant");
  }
}
