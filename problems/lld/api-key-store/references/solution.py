from __future__ import annotations

MAX_NOW = 10**13
MAX_TTL = 10**12
GRACE_MS = 60_000
LOWER = "abcdefghijklmnopqrstuvwxyz"


def _word(text: str) -> bool:
    return text != "" and all(c in LOWER for c in text)


def _checked(scope: str, wildcard: bool) -> str:
    resource, _, action = scope.partition(":")
    if not _word(resource) or not (_word(action) or wildcard and action == "*"):
        raise ValueError("a scope is resource:action")
    return scope


def _grant(scopes: list[str]) -> tuple[str, ...]:
    if not 1 <= len(scopes) <= 20:
        raise ValueError("1 to 20 scopes")
    return tuple(_checked(s, True) for s in scopes)


def _covers(grant: tuple[str, ...], scope: str) -> bool:
    return scope in grant or scope.partition(":")[0] + ":*" in grant


class _Key:
    def __init__(self, owner: str, grant: tuple[str, ...], now: int, ttl: int) -> None:
        self.owner = owner
        self.grant = grant
        self.ttl = ttl
        self.expires = now + ttl
        self.revoked = False
        self.rotated = False

    def live(self, now: int) -> bool:
        return not self.revoked and now < self.expires


class ApiKeyStore:
    def __init__(self) -> None:
        self._keys: dict[str, _Key] = {}

    def _new(self, owner: str, grant: tuple[str, ...], now: int, ttl: int) -> str:
        key_id = f"key-{len(self._keys) + 1}"
        self._keys[key_id] = _Key(owner, grant, now, ttl)
        return key_id

    def issue(self, owner: str, scopes: list[str], nowMs: int, ttlMs: int) -> str:
        grant = _grant(scopes)
        if owner == "" or not 0 <= nowMs <= MAX_NOW or not 1 <= ttlMs <= MAX_TTL:
            raise ValueError("an owner, a time and a time to live")
        return self._new(owner, grant, nowMs, ttlMs)

    def can(self, keyId: str, scope: str, nowMs: int) -> bool:
        _checked(scope, False)
        key = self._keys.get(keyId)
        return key is not None and key.live(nowMs) and _covers(key.grant, scope)

    def narrow(self, keyId: str, scopes: list[str]) -> bool:
        grant = _grant(scopes)
        key = self._keys.get(keyId)
        if key is None or key.revoked or not all(_covers(key.grant, s) for s in grant):
            return False
        key.grant = grant
        return True

    def revoke(self, keyId: str) -> bool:
        key = self._keys.get(keyId)
        if key is None or key.revoked:
            return False
        key.revoked = True
        return True

    # The extension round.
    def rotate(self, keyId: str, nowMs: int) -> str:
        key = self._keys.get(keyId)
        if key is None or key.rotated or not 0 <= nowMs <= MAX_NOW or not key.live(nowMs):
            raise ValueError("only a live key is rotated, once")
        key.rotated = True
        key.expires = min(key.expires, nowMs + GRACE_MS)
        return self._new(key.owner, key.grant, nowMs, key.ttl)
