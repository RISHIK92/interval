const MAX_NOW = 1e13;
const MAX_TTL = 1e12;
const GRACE_MS = 60000;
const WORD = "[a-z]+";

function checked(scope: string, wildcard: boolean): void {
  const action = wildcard ? `(${WORD}|\\*)` : WORD;
  if (!new RegExp(`^${WORD}:${action}$`).test(scope))
    throw new RangeError("a scope is resource:action");
}

function grantOf(scopes: readonly string[]): readonly string[] {
  if (scopes.length < 1 || scopes.length > 20)
    throw new RangeError("1 to 20 scopes");
  for (const s of scopes) checked(s, true);
  return [...scopes];
}

function covers(grant: readonly string[], scope: string): boolean {
  const resource = scope.slice(0, scope.indexOf(":"));
  return grant.includes(scope) || grant.includes(`${resource}:*`);
}

class Key {
  readonly owner: string;
  grant: readonly string[];
  readonly ttl: number;
  expires: number;
  revoked = false;
  rotated = false;

  constructor(
    owner: string,
    grant: readonly string[],
    now: number,
    ttl: number,
  ) {
    this.owner = owner;
    this.grant = grant;
    this.ttl = ttl;
    this.expires = now + ttl;
  }

  live(now: number): boolean {
    return !this.revoked && now < this.expires;
  }
}

export class ApiKeyStore {
  private readonly keys = new Map<string, Key>();

  private add(
    owner: string,
    grant: readonly string[],
    now: number,
    ttl: number,
  ): string {
    const id = `key-${String(this.keys.size + 1)}`;
    this.keys.set(id, new Key(owner, grant, now, ttl));
    return id;
  }

  issue(owner: string, scopes: string[], nowMs: number, ttlMs: number): string {
    const grant = grantOf(scopes);
    if (
      owner === "" ||
      nowMs < 0 ||
      nowMs > MAX_NOW ||
      ttlMs < 1 ||
      ttlMs > MAX_TTL
    )
      throw new RangeError("an owner, a time and a time to live");
    return this.add(owner, grant, nowMs, ttlMs);
  }

  can(keyId: string, scope: string, nowMs: number): boolean {
    checked(scope, false);
    const key = this.keys.get(keyId);
    return key !== undefined && key.live(nowMs) && covers(key.grant, scope);
  }

  narrow(keyId: string, scopes: string[]): boolean {
    const grant = grantOf(scopes);
    const key = this.keys.get(keyId);
    if (
      key === undefined ||
      key.revoked ||
      !grant.every((s) => covers(key.grant, s))
    )
      return false;
    key.grant = grant;
    return true;
  }

  revoke(keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (key === undefined || key.revoked) return false;
    key.revoked = true;
    return true;
  }

  // The extension round.
  rotate(keyId: string, nowMs: number): string {
    const key = this.keys.get(keyId);
    if (
      key === undefined ||
      key.rotated ||
      nowMs < 0 ||
      nowMs > MAX_NOW ||
      !key.live(nowMs)
    )
      throw new RangeError("only a live key is rotated, once");
    key.rotated = true;
    key.expires = Math.min(key.expires, nowMs + GRACE_MS);
    return this.add(key.owner, key.grant, nowMs, key.ttl);
  }
}
