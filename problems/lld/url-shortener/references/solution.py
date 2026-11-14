from __future__ import annotations

import threading

ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


class UrlShortener:
    def __init__(self) -> None:
        # Every live code (generated or custom) to its url and hit count.
        self.urls: dict[str, str] = {}
        self.counts: dict[str, int] = {}
        # A url's generated code, so shortening it again gives the same one.
        self.generated: dict[str, str] = {}
        self.counter = 1
        self.lock = threading.Lock()

    @staticmethod
    def _check_url(url: str) -> None:
        rest = url[8:] if url.startswith("https://") else url[7:] if url.startswith("http://") else ""
        if rest == "" or len(url) > 2048 or " " in url:
            raise ValueError("invalid url")

    @staticmethod
    def _encode(n: int) -> str:
        out = ""
        while n > 0:
            out = ALPHABET[n % 62] + out
            n //= 62
        return out

    def shorten(self, url: str) -> str:
        self._check_url(url)
        with self.lock:
            if url in self.generated:
                return self.generated[url]
            # A custom alias may already hold the next code: skip it.
            while True:
                code = self._encode(self.counter)
                self.counter += 1
                if code not in self.urls:
                    break
            self.urls[code] = url
            self.counts[code] = 0
            self.generated[url] = code
            return code

    def expand(self, code: str) -> str:
        with self.lock:
            if code not in self.urls:
                raise KeyError("unknown code")
            self.counts[code] += 1
            return self.urls[code]

    def custom(self, url: str, alias: str) -> str:
        self._check_url(url)
        if not (1 <= len(alias) <= 16 and all(c in ALPHABET for c in alias)):
            raise ValueError("invalid alias")
        with self.lock:
            if alias in self.urls:
                raise ValueError("alias taken")
            self.urls[alias] = url
            self.counts[alias] = 0
            return alias

    def hits(self, code: str) -> int:
        with self.lock:
            if code not in self.urls:
                raise KeyError("unknown code")
            return self.counts[code]

    def expire(self, code: str) -> None:
        with self.lock:
            if code not in self.urls:
                raise KeyError("unknown code")
            url = self.urls.pop(code)
            del self.counts[code]
            if self.generated.get(url) == code:
                del self.generated[url]
