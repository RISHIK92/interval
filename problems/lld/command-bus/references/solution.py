from __future__ import annotations

MAX_REPLICAS = 1000


class Service:
    def __init__(self) -> None:
        self.replicas = 0
        self.paused = False


class Scale:
    """A command object: it knows how to run itself and how to take itself back."""

    def __init__(self, service: str, target: int) -> None:
        self.service = service
        self.target = target
        self.before: int | None = None

    # Running reports whether anything changed: a command that changed nothing has
    # nothing to undo.
    def run(self, service: Service) -> bool:
        self.before = service.replicas
        service.replicas = self.target
        return self.before != self.target

    def undo(self, service: Service) -> None:
        if self.before is not None:
            service.replicas = self.before


class Pause:
    def __init__(self, service: str) -> None:
        self.service = service

    def run(self, service: Service) -> bool:
        changed = not service.paused
        service.paused = True
        return changed

    def undo(self, service: Service) -> None:
        service.paused = False


class Resume:
    def __init__(self, service: str) -> None:
        self.service = service

    def run(self, service: Service) -> bool:
        changed = service.paused
        service.paused = False
        return changed

    def undo(self, service: Service) -> None:
        service.paused = True


Command = Scale | Pause | Resume


def parse(command: str, arg: str) -> Command:
    if command == "scale":
        name, _, count = arg.partition("=")
        if (
            name == ""
            or not count.isdigit()
            or (count != "0" and count.startswith("0"))
            or int(count) > MAX_REPLICAS
        ):
            raise ValueError("scale takes <service>=<0 to 1000>")
        return Scale(name, int(count))
    if arg == "" or "=" in arg:
        raise ValueError("a service name")
    if command == "pause":
        return Pause(arg)
    if command == "resume":
        return Resume(arg)
    raise ValueError("unknown command")


class CommandBus:
    def __init__(self) -> None:
        self._services: dict[str, Service] = {}
        self._ids: set[str] = set()
        self._queue: list[tuple[str, str, str, Command]] = []
        self._scheduled: list[tuple[int, str, str, str, Command]] = []
        self._done: list[tuple[str, Command]] = []
        self._log: list[str] = []

    def _accept(self, id: str, command: str, arg: str) -> Command | None:
        if id == "":
            raise ValueError("an empty id")
        parsed = parse(command, arg)
        if id in self._ids:
            return None
        self._ids.add(id)
        return parsed

    def _run(self, id: str, command: str, arg: str, parsed: Command) -> str:
        service = self._services.setdefault(parsed.service, Service())
        if parsed.run(service):
            self._done.append((id, parsed))
            line = f"{id}: {command} {arg}"
        else:
            line = f"{id}: skipped"
        self._log.append(line)
        return line

    def submit(self, id: str, command: str, arg: str) -> bool:
        parsed = self._accept(id, command, arg)
        if parsed is None:
            return False
        self._queue.append((id, command, arg, parsed))
        return True

    def execute(self) -> list[str]:
        queue, self._queue = self._queue, []
        return [self._run(*entry) for entry in queue]

    def undoLast(self) -> str | None:
        if not self._done:
            return None
        id, command = self._done.pop()
        command.undo(self._services[command.service])
        self._log.append(f"{id}: undone")
        return id

    def replicas(self, service: str) -> int:
        if service == "":
            raise ValueError("an empty service")
        found = self._services.get(service)
        return 0 if found is None or found.paused else found.replicas

    def log(self) -> list[str]:
        return list(self._log)

    # The extension round: commands that wait for their time, sharing the ids and the undo stack.
    def schedule(self, id: str, command: str, arg: str, atMs: int) -> bool:
        if atMs < 0:
            raise ValueError("a negative time")
        parsed = self._accept(id, command, arg)
        if parsed is None:
            return False
        self._scheduled.append((atMs, id, command, arg, parsed))
        return True

    def executeDue(self, nowMs: int) -> list[str]:
        if nowMs < 0:
            raise ValueError("a negative time")
        # A stable sort: commands due at the same time run in the order they were scheduled.
        due = sorted((entry for entry in self._scheduled if entry[0] <= nowMs), key=lambda entry: entry[0])
        self._scheduled = [entry for entry in self._scheduled if entry[0] > nowMs]
        return [self._run(*entry[1:]) for entry in due]
