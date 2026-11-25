from __future__ import annotations

LIFETIMES = {"singleton", "transient", "scoped"}


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty")


class Provider:
    """How to make one service: its lifetime, what it needs, and how many it has made.
    Each instance is its service's name and number, followed by the instances it was
    given, so the string shows exactly which instances are shared."""

    def __init__(self, service: str, lifetime: str, deps: list[str]) -> None:
        self.service = service
        self.lifetime = lifetime
        self.deps = list(deps)
        self.made = 0
        self.wrappers: list[str] = []

    def construct(self, deps: list[str]) -> str:
        self.made += 1
        instance = f"{self.service}#{self.made}"
        if deps:
            instance += f"({','.join(deps)})"
        for wrapper in self.wrappers:
            instance = f"{wrapper}[{instance}]"
        return instance


class DiContainer:
    """Services are registered with a lifetime and named dependencies, and nothing is made
    until something asks for it. The lifetime decides where an instance is kept: once for
    the container, once per scope, or nowhere (a new one every time)."""

    def __init__(self) -> None:
        self._providers: dict[str, Provider] = {}
        self._singletons: dict[str, str] = {}
        self._scopes: dict[str, dict[str, str]] = {}

    def provide(self, service: str, lifetime: str, deps: list[str]) -> None:
        _given(service)
        if lifetime not in LIFETIMES:
            raise ValueError("unknown lifetime")
        for dep in deps:
            _given(dep)
        if len(set(deps)) != len(deps):
            raise ValueError("a dependency listed twice")
        if service in self._providers:
            raise ValueError("already provided")
        self._providers[service] = Provider(service, lifetime, deps)

    def resolve(self, service: str, scope: str) -> str:
        _given(scope)
        # Check the whole graph first, so a resolve that fails constructs nothing.
        self._check(service, False, set(), set())
        return self._instance(service, scope)

    def constructed(self, service: str) -> int:
        return self._provider(service).made

    def endScope(self, scope: str) -> int:
        _given(scope)
        return len(self._scopes.pop(scope, {}))

    # The extension round: wrapping a service without changing it.
    def decorate(self, service: str, wrapper: str) -> None:
        _given(wrapper)
        self._provider(service).wrappers.append(wrapper)

    def _provider(self, service: str) -> Provider:
        found = self._providers.get(service)
        if found is None:
            raise ValueError("unknown service")
        return found

    def _check(self, service: str, in_singleton: bool, path: set[str], done: set[tuple[str, bool]]) -> None:
        provider = self._provider(service)
        if service in path:
            raise ValueError("a dependency cycle")
        if in_singleton and provider.lifetime == "scoped":
            raise ValueError("a singleton would hold on to a scoped instance")
        if (service, in_singleton) in done:
            return
        path.add(service)
        for dep in provider.deps:
            self._check(dep, in_singleton or provider.lifetime == "singleton", path, done)
        path.remove(service)
        done.add((service, in_singleton))

    def _instance(self, service: str, scope: str) -> str:
        provider = self._providers[service]
        kept = None
        if provider.lifetime == "singleton":
            kept = self._singletons
        elif provider.lifetime == "scoped":
            kept = self._scopes.setdefault(scope, {})
        if kept is not None and service in kept:
            return kept[service]
        instance = provider.construct([self._instance(dep, scope) for dep in provider.deps])
        if kept is not None:
            kept[service] = instance
        return instance
