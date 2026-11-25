from __future__ import annotations

MAX_LENGTH = 200


def _host(url: str) -> str:
    """The URL's host in lower case: after the first "://", up to the path, query or
    fragment, without a port. Empty when there's no "://"."""
    at = url.find("://")
    if at < 0:
        return ""
    rest = url[at + 3 :]
    for stop in "/?#:":
        rest = rest.partition(stop)[0]
    return rest.lower()


def _ipv4(host: str) -> list[int] | None:
    parts = host.split(".")
    if len(parts) != 4 or any(not (len(p) <= 3 and p.isdigit()) for p in parts):
        return None
    numbers = [int(p) for p in parts]
    return numbers if all(n <= 255 for n in numbers) else None


def _internal(host: str) -> bool:
    if host in ("", "localhost"):
        return True
    ip = _ipv4(host)
    return ip is not None and (
        ip[0] in (10, 127) or (ip[0] == 172 and 16 <= ip[1] <= 31) or (ip[0] == 192 and ip[1] == 168)
    )


class UrlPolicy:
    """The one place the URL rules live. Every entry point asks it, so a new rule is one
    change here and can never apply at one entry point and not another."""

    def __init__(self) -> None:
        self._blocked: set[str] = set()

    def block(self, host: str) -> None:
        self._blocked.add(host.lower())

    def violations(self, url: str) -> list[str]:
        if url == "":
            raise ValueError("a URL is not empty")
        host = _host(url)
        found: list[str] = []
        if len(url) > MAX_LENGTH:
            found.append("length")
        if not url.startswith("https://"):
            found.append("scheme")
        if _internal(host):
            found.append("host")
        if host in self._blocked:
            found.append("blocked")
        return found


class WebhookRules:
    def __init__(self) -> None:
        self._policy = UrlPolicy()
        self._hooks: dict[str, str] = {}  # id -> URL, in creation order

    def createHook(self, url: str) -> list[str]:
        found = self._policy.violations(url)
        if not found:
            self._hooks[f"hook-{len(self._hooks) + 1}"] = url
        return found

    def updateHook(self, hookId: str, url: str) -> list[str]:
        if hookId not in self._hooks:
            raise KeyError("no such hook")
        found = self._policy.violations(url)
        if not found:
            self._hooks[hookId] = url
        return found

    def testUrl(self, url: str) -> list[str]:
        return self._policy.violations(url)

    def hooks(self) -> list[str]:
        return [f"{hook_id} {url}" for hook_id, url in self._hooks.items()]

    # The extension round: one more rule, in the one place rules live.
    def blockHost(self, host: str) -> None:
        if host == "":
            raise ValueError("a host is not empty")
        self._policy.block(host)
