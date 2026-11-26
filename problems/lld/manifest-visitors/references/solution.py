from __future__ import annotations

from abc import ABC, abstractmethod


class Deployment:
    def __init__(self, name: str, f: dict[str, int]) -> None:
        self.name = name
        self.replicas = f["replicas"]
        self.cpu = f.get("cpu")
        self.memory = f.get("memory")
        self.privileged = f.get("privileged") == 1

    def accept(self, v: Visitor) -> None:
        v.deployment(self)


class Service:
    def __init__(self, name: str, f: dict[str, int]) -> None:
        self.name = name
        self.port = f["port"]
        self.public = f.get("public") == 1

    def accept(self, v: Visitor) -> None:
        v.service(self)


class ConfigMap:
    def __init__(self, name: str, f: dict[str, int]) -> None:
        self.name = name
        self.entries = f["entries"]
        # Left out or 0 both mean none.
        self.has_secrets = bool(f.get("secrets"))

    def accept(self, v: Visitor) -> None:
        v.configmap(self)


Manifest = Deployment | Service | ConfigMap


class Visitor(ABC):
    """One operation over every kind. A new operation is a new visitor; the manifest
    classes above never change for it."""

    def __init__(self) -> None:
        self.lines: list[str] = []

    @abstractmethod
    def deployment(self, d: Deployment) -> None: ...

    @abstractmethod
    def service(self, s: Service) -> None: ...

    @abstractmethod
    def configmap(self, c: ConfigMap) -> None: ...

    def finish(self) -> list[str]:
        return self.lines


class Inventory(Visitor):
    def deployment(self, d: Deployment) -> None:
        self.lines.append(f"deployment/{d.name} replicas={d.replicas}")

    def service(self, s: Service) -> None:
        self.lines.append(f"service/{s.name} port={s.port}")

    def configmap(self, c: ConfigMap) -> None:
        self.lines.append(f"configmap/{c.name} entries={c.entries}")


class Lint(Visitor):
    def deployment(self, d: Deployment) -> None:
        if d.replicas == 1:
            self.lines.append(f"deployment/{d.name}: single replica")
        if d.cpu is None:
            self.lines.append(f"deployment/{d.name}: no cpu limit")

    def service(self, s: Service) -> None:
        pass

    def configmap(self, c: ConfigMap) -> None:
        if c.entries == 0:
            self.lines.append(f"configmap/{c.name}: empty")


class Cost(Visitor):
    def __init__(self) -> None:
        super().__init__()
        self.total = 0

    def add(self, what: str, cost: int) -> None:
        self.lines.append(f"{what} {cost}")
        self.total += cost

    def deployment(self, d: Deployment) -> None:
        self.add(f"deployment/{d.name}", d.replicas * ((d.cpu or 0) + (d.memory or 0)))

    def service(self, s: Service) -> None:
        self.add(f"service/{s.name}", LOAD_BALANCER if s.public else 0)

    def configmap(self, c: ConfigMap) -> None:
        self.add(f"configmap/{c.name}", 0)

    def finish(self) -> list[str]:
        return [*self.lines, f"total {self.total}"]


class SecurityAudit(Visitor):
    def deployment(self, d: Deployment) -> None:
        if d.privileged:
            self.lines.append(f"deployment/{d.name}: privileged")

    def service(self, s: Service) -> None:
        if s.public:
            self.lines.append(f"service/{s.name}: public")

    def configmap(self, c: ConfigMap) -> None:
        if c.has_secrets:
            self.lines.append(f"configmap/{c.name}: plain-text secrets")


LOAD_BALANCER = 20
MOST = 1_000_000
VISITORS: dict[str, type[Visitor]] = {
    "inventory": Inventory,
    "lint": Lint,
    "cost": Cost,
}

# Per kind: each field with its least and greatest value, and whether it is required.
FLAG = (0, 1, False)
FIELDS: dict[str, tuple[type[Manifest], dict[str, tuple[int, int, bool]]]] = {
    "deployment": (
        Deployment,
        {
            "replicas": (0, MOST, True),
            "cpu": (1, MOST, False),
            "memory": (1, MOST, False),
            "privileged": FLAG,
        },
    ),
    "service": (Service, {"port": (1, 65535, True), "public": FLAG}),
    "configmap": (
        ConfigMap,
        {"entries": (0, MOST, True), "secrets": (0, MOST, False)},
    ),
}


class ManifestSet:
    def __init__(self) -> None:
        self._items: list[Manifest] = []
        self._names: set[tuple[str, str]] = set()

    def addResource(self, kind: str, name: str, fields: dict[str, int]) -> bool:
        if kind not in FIELDS or name == "":
            raise ValueError("unknown kind or empty name")
        make, allowed = FIELDS[kind]
        for field, value in fields.items():
            if field not in allowed:
                raise ValueError("unknown field")
            low, high, _ = allowed[field]
            if value < low or value > high:
                raise ValueError("value out of range")
        if any(
            required and field not in fields
            for field, (_, _, required) in allowed.items()
        ):
            raise ValueError("missing field")
        if (kind, name) in self._names:
            return False
        self._names.add((kind, name))
        self._items.append(make(name, fields))
        return True

    def runVisitor(self, visitor: str) -> list[str]:
        if visitor not in VISITORS:
            raise ValueError("unknown visitor")
        return self._walk(VISITORS[visitor]())

    def kinds(self) -> list[str]:
        return sorted({kind for kind, _ in self._names})

    # The extension round: a fourth operation, and no manifest class changes.
    def securityAudit(self) -> list[str]:
        return self._walk(SecurityAudit())

    def _walk(self, v: Visitor) -> list[str]:
        for item in self._items:
            item.accept(v)
        return v.finish()
