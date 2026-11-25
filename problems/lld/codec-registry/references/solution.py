from __future__ import annotations

import re
from abc import ABC, abstractmethod

TOKEN = r"[a-z0-9][a-z0-9.+-]*"
CONTENT_TYPE = re.compile(f"{TOKEN}/{TOKEN}")
MEDIA_RANGE = re.compile(rf"\*/\*|{TOKEN}/\*|{TOKEN}/{TOKEN}")
QUALITY = re.compile(r"0(\.[0-9]{0,3})?|1(\.0{0,3})?")
UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"


class Codec(ABC):
    """What the registry needs from a codec: turn a flat record into text. Fields arrive
    sorted by name, so every codec writes them in the same order."""

    @abstractmethod
    def encode(self, fields: list[tuple[str, str]]) -> str: ...


class JsonCodec(Codec):
    def encode(self, fields: list[tuple[str, str]]) -> str:
        def quoted(text: str) -> str:
            return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'

        return "{" + ",".join(f"{quoted(k)}:{quoted(v)}" for k, v in fields) + "}"


class FormCodec(Codec):
    def encode(self, fields: list[tuple[str, str]]) -> str:
        def escaped(text: str) -> str:
            return "".join(c if c in UNRESERVED else f"%{ord(c):02X}" for c in text)

        return "&".join(f"{escaped(k)}={escaped(v)}" for k, v in fields)


class CsvCodec(Codec):
    def encode(self, fields: list[tuple[str, str]]) -> str:
        def cell(text: str) -> str:
            if "," in text or '"' in text:
                return '"' + text.replace('"', '""') + '"'
            return text

        header = ",".join(cell(k) for k, _ in fields)
        return header + "\n" + ",".join(cell(v) for _, v in fields)


# The factory method's table: a codec's name makes its codec, and nothing else in the
# registry knows the concrete classes. A new format is a class and a line here.
CODECS: dict[str, type[Codec]] = {"json": JsonCodec, "form": FormCodec, "csv": CsvCodec}


def make_codec(name: str) -> Codec:
    made = CODECS.get(name)
    if made is None:
        raise ValueError("unknown codec")
    return made()


def _quality(text: str) -> int:
    """A q-value in thousandths, so no float is ever compared."""
    if QUALITY.fullmatch(text) is None:
        raise ValueError("bad q-value")
    whole, _, fraction = text.partition(".")
    return int(whole) * 1000 + int(fraction.ljust(3, "0"))


def _ranges(accept: str) -> dict[str, int]:
    ranges: dict[str, int] = {}
    for item in accept.split(","):
        parts = [p.strip(" ") for p in item.split(";")]
        media = parts[0]
        if MEDIA_RANGE.fullmatch(media) is None or media in ranges or len(parts) > 2:
            raise ValueError("bad media range")
        quality = 1000
        if len(parts) == 2:
            if not parts[1].startswith("q="):
                raise ValueError("only q is allowed")
            quality = _quality(parts[1][2:])
        ranges[media] = quality
    return ranges


class CodecRegistry:
    def __init__(self) -> None:
        self._codecs: dict[str, Codec] = {}  # in the order they were added
        self._fallback: str | None = None

    def add(self, contentType: str, codec: str) -> None:
        if CONTENT_TYPE.fullmatch(contentType) is None:
            raise ValueError("bad content type")
        if contentType in self._codecs:
            raise ValueError("already added")
        self._codecs[contentType] = make_codec(codec)

    def negotiate(self, accept: str) -> str | None:
        ranges = _ranges(accept)
        best: str | None = None
        best_quality = 0
        for content_type in self._codecs:
            # The most specific range that matches decides, even when it says q=0.
            top = content_type.split("/")[0]
            quality = next(
                (ranges[r] for r in (content_type, f"{top}/*", "*/*") if r in ranges), None
            )
            if quality is not None and quality > best_quality:
                best, best_quality = content_type, quality
        return best if best is not None else self._fallback

    def encodeWith(self, contentType: str, fields: dict[str, str]) -> str:
        codec = self._codecs.get(contentType)
        if codec is None:
            raise ValueError("no codec for that type")
        if not fields or "" in fields or "" in fields.values():
            raise ValueError("empty record, name or value")
        return codec.encode(sorted(fields.items()))

    # The extension round: a type to answer with when nothing is acceptable.
    def fallbackType(self, contentType: str) -> None:
        if contentType not in self._codecs:
            raise ValueError("no codec for that type")
        self._fallback = contentType
