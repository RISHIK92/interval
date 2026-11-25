from __future__ import annotations

OK = 200
UNAUTHORIZED = 401


class Handler:
    """The innermost handler: it serves every request it's given."""

    def __init__(self, name: str) -> None:
        self.name = name

    def serve(self, path: str, token: str, trace: list[str]) -> int:
        trace.append(f"{self.name} {path}")
        return OK


class Layer(Handler):
    """A decorator: it looks like a handler, holds the one it wraps, and adds its own lines
    around the call. Subclasses change only the part they're about."""

    def __init__(self, name: str, inner: Handler) -> None:
        super().__init__(name)
        self.inner = inner

    def serve(self, path: str, token: str, trace: list[str]) -> int:
        trace.append(self.entered())
        status = self.inside(path, token, trace)
        trace.append(self.left(status))
        return status

    def entered(self) -> str:
        return f"enter {self.name}"

    def inside(self, path: str, token: str, trace: list[str]) -> int:
        return self.inner.serve(path, token, trace)

    def left(self, status: int) -> str:
        return f"leave {self.name}"


class Auth(Layer):
    def inside(self, path: str, token: str, trace: list[str]) -> int:
        if not token.startswith("Bearer ") or len(token) == len("Bearer "):
            trace.append("deny")
            return UNAUTHORIZED
        return super().inside(path, token, trace)


class RequestId(Layer):
    def __init__(self, name: str, inner: Handler) -> None:
        super().__init__(name, inner)
        self.seen = 0

    def entered(self) -> str:
        self.seen += 1
        return f"{super().entered()} {self.seen}"


class Compress(Layer):
    def left(self, status: int) -> str:
        if status == OK:
            return f"{super().left(status)} gzip"
        return super().left(status)


KINDS: dict[str, type[Layer]] = {"auth": Auth, "request-id": RequestId, "compress": Compress}


class HandlerStack:
    """A handler wrapped in layers, the last one wrapped outermost."""

    def __init__(self, handler: str) -> None:
        if handler == "":
            raise ValueError("empty handler")
        self._top: Handler = Handler(handler)
        self._layers: list[Layer] = []

    def wrap(self, layer: str) -> None:
        kind = KINDS.get(layer)
        if kind is None:
            raise ValueError("unknown layer")
        self._top = kind(layer, self._top)
        self._layers.append(self._top)

    def handle(self, path: str, token: str) -> list[str]:
        if path == "" or token == "":
            raise ValueError("empty path or token")
        trace: list[str] = []
        status = self._top.serve(path, token, trace)
        trace.append(str(status))
        return trace

    def layers(self) -> list[str]:
        return [layer.name for layer in reversed(self._layers)]

    # The extension round: peeling the outermost layer off again.
    def unwrap(self) -> bool:
        if not self._layers:
            return False
        self._top = self._layers.pop().inner
        return True
