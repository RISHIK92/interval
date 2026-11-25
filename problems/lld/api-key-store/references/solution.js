"use strict";

const MAX_NOW = 1e13;
const MAX_TTL = 1e12;
const GRACE_MS = 60000;
const WORD = "[a-z]+";

function checked(scope, wildcard) {
  const action = wildcard ? `(${WORD}|\\*)` : WORD;
  if (!new RegExp(`^${WORD}:${action}$`).test(scope))
    throw new RangeError("a scope is resource:action");
}

function grantOf(scopes) {
  if (scopes.length < 1 || scopes.length > 20)
    throw new RangeError("1 to 20 scopes");
  for (const s of scopes) checked(s, true);
  return [...scopes];
}

function covers(grant, scope) {
  const resource = scope.slice(0, scope.indexOf(":"));
  return grant.includes(scope) || grant.includes(`${resource}:*`);
}

class ApiKeyStore {
  #keys = new Map();

  #new(owner, grant, now, ttl) {
    const id = `key-${this.#keys.size + 1}`;
    this.#keys.set(id, {
      owner,
      grant,
      ttl,
      expires: now + ttl,
      revoked: false,
      rotated: false,
    });
    return id;
  }

  #live(key, now) {
    return !key.revoked && now < key.expires;
  }

  issue(owner, scopes, nowMs, ttlMs) {
    const grant = grantOf(scopes);
    if (
      owner === "" ||
      nowMs < 0 ||
      nowMs > MAX_NOW ||
      ttlMs < 1 ||
      ttlMs > MAX_TTL
    )
      throw new RangeError("an owner, a time and a time to live");
    return this.#new(owner, grant, nowMs, ttlMs);
  }

  can(keyId, scope, nowMs) {
    checked(scope, false);
    const key = this.#keys.get(keyId);
    return (
      key !== undefined && this.#live(key, nowMs) && covers(key.grant, scope)
    );
  }

  narrow(keyId, scopes) {
    const grant = grantOf(scopes);
    const key = this.#keys.get(keyId);
    if (
      key === undefined ||
      key.revoked ||
      !grant.every((s) => covers(key.grant, s))
    )
      return false;
    key.grant = grant;
    return true;
  }

  revoke(keyId) {
    const key = this.#keys.get(keyId);
    if (key === undefined || key.revoked) return false;
    key.revoked = true;
    return true;
  }

  // The extension round.
  rotate(keyId, nowMs) {
    const key = this.#keys.get(keyId);
    if (
      key === undefined ||
      key.rotated ||
      nowMs < 0 ||
      nowMs > MAX_NOW ||
      !this.#live(key, nowMs)
    )
      throw new RangeError("only a live key is rotated, once");
    key.rotated = true;
    key.expires = Math.min(key.expires, nowMs + GRACE_MS);
    return this.#new(key.owner, key.grant, nowMs, key.ttl);
  }
}

module.exports = { ApiKeyStore };
