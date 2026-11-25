from __future__ import annotations

MIN_WORKERS, MAX_WORKERS = 1, 64
MAX_RETRIES = 10


def _expect(holds: bool, what: str) -> None:
    if not holds:
        raise ValueError(what)


def _valid_workers(n: int) -> bool:
    return MIN_WORKERS <= n <= MAX_WORKERS


class ServiceSettings:
    """Every precondition is checked once, at construction: a ServiceSettings that exists
    is valid, and no later call can make it invalid (its class invariant)."""

    def __init__(self, port: int, workers: int, timeoutMs: int) -> None:
        _expect(1 <= port <= 65535, "port is from 1 to 65535")
        _expect(_valid_workers(workers), "workers is from 1 to 64")
        _expect(1 <= timeoutMs <= 60_000, "timeoutMs is from 1 to 60000")
        self._port = port
        self._workers = workers
        self._timeout_ms = timeoutMs
        self._tls: tuple[str, str] | None = None

    def withWorkers(self, n: int) -> bool:
        if not _valid_workers(n):
            return False
        self._workers = n
        return True

    def budgetMs(self, retries: int) -> int:
        _expect(0 <= retries <= MAX_RETRIES, "retries is from 0 to 10")
        return self._timeout_ms * (retries + 1)

    def describe(self) -> str:
        text = f"port={self._port} workers={self._workers} timeoutMs={self._timeout_ms}"
        if self._tls is not None:
            text += f" tls={self._tls[0]},{self._tls[1]}"
        return text

    # The extension round: TLS is both paths or neither, never half configured.
    def withTls(self, certPath: str, keyPath: str) -> bool:
        if (certPath == "") != (keyPath == ""):
            return False
        self._tls = (certPath, keyPath) if certPath else None
        return True
