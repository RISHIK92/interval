from __future__ import annotations

NONE = "-"


def _path(path: str) -> None:
    if not path.startswith("/"):
        raise ValueError("a path starts with /")


def _prefix(prefix: str) -> None:
    _path(prefix)
    if prefix != "/" and prefix.endswith("/"):
        raise ValueError("only / itself ends with /")


def _matches(prefix: str, path: str) -> bool:
    return prefix == "/" or path == prefix or path.startswith(prefix + "/")


def _longest(prefixes: list[str], path: str) -> str | None:
    # Prefixes that match one path are nested, so the longest is the most specific.
    return max((p for p in prefixes if _matches(p, path)), key=len, default=None)


class ScriptedService:
    """A fake upstream: answers with its statuses in order, then repeats the last."""

    def __init__(self, statuses: list[int]) -> None:
        self.statuses = list(statuses)
        self.served = 0

    def answer(self) -> int:
        status = self.statuses[min(self.served, len(self.statuses) - 1)]
        self.served += 1
        return status


class Route:
    """One prefix's settings and, when it caches, its own responses by path."""

    def __init__(self, service: str) -> None:
        self.service = service
        self.auth = False
        self.ttl = 0
        self.cached: dict[str, tuple[int, int]] = {}  # path -> (status, expires at)


class Gateway:
    """The facade: one request call hides routing, the auth check, the response cache
    (a proxy in front of each service) and the services themselves."""

    def __init__(self) -> None:
        self._routes: dict[str, Route] = {}
        self._services: dict[str, ScriptedService] = {}
        self._rewrites: dict[str, str] = {}

    def route(self, prefix: str, service: str) -> None:
        _prefix(prefix)
        if service == "":
            raise ValueError("an empty service")
        found = self._routes.get(prefix)
        if found is None:
            self._routes[prefix] = Route(service)
        else:
            found.service = service
            found.cached.clear()

    def requireAuth(self, prefix: str) -> None:
        self._route(prefix).auth = True

    def cache(self, prefix: str, ttlMs: int) -> None:
        route = self._route(prefix)
        if ttlMs < 1:
            raise ValueError("a ttl is at least 1 ms")
        route.ttl = ttlMs

    def upstream(self, service: str, statuses: list[int]) -> None:
        if service == "" or not statuses:
            raise ValueError("an empty service or script")
        for status in statuses:
            if status < 100 or status > 599:
                raise ValueError("not an HTTP status")
        self._services[service] = ScriptedService(statuses)

    def request(self, path: str, token: str, nowMs: int) -> list[str]:
        _path(path)
        rewrite = _longest(list(self._rewrites), path)
        if rewrite is not None:
            path = self._rewrites[rewrite] + path[len(rewrite) :]
        prefix = _longest(list(self._routes), path)
        if prefix is None:
            return ["404", NONE, NONE]
        route = self._routes[prefix]
        if route.auth and token == "":
            return ["401", NONE, NONE]
        kept = route.cached.get(path)
        if kept is not None and nowMs < kept[1]:
            return [str(kept[0]), route.service, "hit"]
        service = self._services.get(route.service)
        if service is None:
            return ["502", NONE, NONE]
        status = service.answer()
        if route.ttl == 0:
            return [str(status), route.service, NONE]
        if status == 200:
            route.cached[path] = (status, nowMs + route.ttl)
        return [str(status), route.service, "miss"]

    # The extension round: a path rewrite in front of the routing.
    def rewrite(self, prefix: str, replacement: str) -> None:
        _prefix(prefix)
        _prefix(replacement)
        if "/" in (prefix, replacement):
            raise ValueError("/ can't be rewritten or be a rewrite")
        self._rewrites[prefix] = replacement

    def _route(self, prefix: str) -> Route:
        if prefix not in self._routes:
            raise KeyError("no such route")
        return self._routes[prefix]
