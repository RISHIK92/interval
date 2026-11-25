from __future__ import annotations

import threading


def _filled(text: str) -> None:
    if text == "":
        raise ValueError("keys and values are not empty")


class _Settings:
    """The one loaded copy of the settings. Only the holder creates it, and only when
    something first needs a setting."""

    def __init__(self, source: dict[str, str]) -> None:
        self.entries = dict(source)


# The holder is the process's single access point; the harness builds one per test, so
# the one instance lives in the holder rather than in a global.
class SettingsHolder:
    def __init__(self, defaults: dict[str, str]) -> None:
        for key, value in defaults.items():
            _filled(key)
            _filled(value)
        self._source = dict(defaults)
        self._overrides: dict[str, str] = {}
        self._settings: _Settings | None = None
        self._loads = 0
        # Every reader goes through _instance, so the lock makes "load once" hold even
        # when many threads ask for their first setting together.
        self._lock = threading.RLock()

    def _instance(self) -> _Settings:
        with self._lock:
            if self._settings is None:
                self._settings = _Settings(self._source)
                self._loads += 1
            return self._settings

    def value(self, key: str) -> str | None:
        _filled(key)
        with self._lock:
            loaded = self._instance().entries
            return self._overrides.get(key, loaded.get(key))

    def loads(self) -> int:
        return self._loads

    def overrideKey(self, key: str, value: str) -> None:
        _filled(key)
        _filled(value)
        with self._lock:
            self._overrides[key] = value

    def reload(self) -> None:
        with self._lock:
            self._settings = None
            self._overrides.clear()

    # The extension round: a view of one prefix, read through the same single instance.
    def scoped(self, prefix: str) -> dict[str, str]:
        _filled(prefix)
        with self._lock:
            merged = {**self._instance().entries, **self._overrides}
        return {k: v for k, v in merged.items() if k.startswith(prefix)}
