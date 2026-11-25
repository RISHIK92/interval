from __future__ import annotations

import re
from typing import NamedTuple
from urllib.parse import quote

METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})
BODILESS = frozenset({"GET", "HEAD"})
URL = re.compile(r"https?://[^?# ]+")
TOKEN = re.compile(r"[A-Za-z0-9-]+")


def _filled(text: str) -> None:
    if text == "":
        raise ValueError("not empty")


def _canonical(name: str) -> str:
    if not TOKEN.fullmatch(name):
        raise ValueError("a header name is letters, digits and dashes")
    return "-".join(part[:1].upper() + part[1:].lower() for part in name.split("-"))


class _Request(NamedTuple):
    """What build produces: a tuple, so nothing can change a request once it is built."""

    line: str
    headers: tuple[tuple[str, str], ...]
    body: str

    def lines(self) -> list[str]:
        return [self.line, *(f"{n}: {v}" for n, v in self.headers), "", self.body]


class RequestBuilder:
    def __init__(self, method: str, url: str) -> None:
        if method not in METHODS:
            raise ValueError("unknown method")
        if not URL.fullmatch(url):
            raise ValueError("bad url")
        self._method = method
        self._url = url
        self._headers: dict[str, str] = {}
        self._query: list[str] = []
        self._body: str | None = None
        self._built: _Request | None = None

    def _open(self) -> None:
        if self._built is not None:
            raise RuntimeError("the request is built")

    def header(self, name: str, value: str) -> None:
        self._open()
        canonical = _canonical(name)
        if canonical == "Content-Length":
            raise ValueError("the length is set automatically")
        trimmed = value.strip(" ")
        _filled(trimmed)
        self._headers[canonical] = trimmed

    def query(self, key: str, value: str) -> None:
        self._open()
        _filled(key)
        _filled(value)
        self._query.append(f"{quote(key, safe='')}={quote(value, safe='')}")

    def body(self, text: str) -> None:
        self._open()
        _filled(text)
        self._body = text

    def build(self) -> list[str]:
        if self._built is None:
            if self._body is not None and self._method in BODILESS:
                raise ValueError("this method takes no body")
            headers = dict(self._headers)
            if self._body is not None:
                headers["Content-Length"] = str(len(self._body))
            target = self._url + ("?" + "&".join(self._query) if self._query else "")
            self._built = _Request(
                f"{self._method} {target}", tuple(sorted(headers.items())), self._body or ""
            )
        return self._built.lines()

    # The extension round: a shortcut that won't stack a second credential.
    def bearer(self, token: str) -> bool:
        self._open()
        _filled(token)
        if " " in token:
            raise ValueError("a token has no spaces")
        if "Authorization" in self._headers:
            return False
        self._headers["Authorization"] = f"Bearer {token}"
        return True
