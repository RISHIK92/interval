from __future__ import annotations

import base64
from abc import ABC, abstractmethod

MAX_LAYERS = 8


def _payload(text: str) -> bool:
    """What any layer can be given to encode: non-empty printable ASCII."""
    return text != "" and all(" " <= c <= "~" for c in text)


class Codec(ABC):
    @abstractmethod
    def encode(self, text: str) -> str: ...

    @abstractmethod
    def decode(self, text: str) -> str: ...


class Plain(Codec):
    """The innermost codec: the text as it is."""

    def encode(self, text: str) -> str:
        return text

    def decode(self, text: str) -> str:
        return text


class Layer(Codec):
    """A decorator: it wraps another codec and adds one step on the outside. Decoding
    accepts only what encoding could have produced: whatever unwrap gives back must be
    a valid payload that wraps to exactly the input again."""

    def __init__(self, inner: Codec) -> None:
        self._inner = inner

    @abstractmethod
    def wrap(self, text: str) -> str: ...

    @abstractmethod
    def unwrap(self, text: str) -> str: ...

    def encode(self, text: str) -> str:
        return self.wrap(self._inner.encode(text))

    def decode(self, text: str) -> str:
        raw = self.unwrap(text)
        if not _payload(raw) or self.wrap(raw) != text:
            raise ValueError("not something this layer produced")
        return self._inner.decode(raw)


class Base64(Layer):
    def wrap(self, text: str) -> str:
        return base64.b64encode(text.encode("latin-1")).decode("ascii")

    def unwrap(self, text: str) -> str:
        return base64.b64decode(text).decode("latin-1")


class Hex(Layer):
    def wrap(self, text: str) -> str:
        return text.encode("latin-1").hex()

    def unwrap(self, text: str) -> str:
        return bytes.fromhex(text).decode("latin-1")


class Frame(Layer):
    """A length prefix: "<length>:<text>"."""

    def wrap(self, text: str) -> str:
        return f"{len(text)}:{text}"

    def unwrap(self, text: str) -> str:
        return text.partition(":")[2]


class Checksum(Layer):
    """The extension's layer: one check digit, the sum of the character codes mod 10."""

    def wrap(self, text: str) -> str:
        return text + str(sum(ord(c) for c in text) % 10)

    def unwrap(self, text: str) -> str:
        return text[:-1]


LAYERS: dict[str, type[Layer]] = {"base64": Base64, "hex": Hex, "frame": Frame}


class PayloadPipeline:
    def __init__(self) -> None:
        self._codec: Codec = Plain()
        self._names: list[str] = []

    def push(self, layer: str) -> None:
        found = LAYERS.get(layer)
        if found is None:
            raise ValueError("unknown layer")
        self._add(layer, found)

    def encode(self, text: str) -> str:
        if not _payload(text):
            raise ValueError("not a payload")
        return self._codec.encode(text)

    def decode(self, text: str) -> str:
        if not _payload(text):
            raise ValueError("not a payload")
        return self._codec.decode(text)

    def layers(self) -> list[str]:
        return list(self._names)

    # The extension round: a layer that catches corruption.
    def checksum(self) -> None:
        self._add("checksum", Checksum)

    def _add(self, name: str, layer: type[Layer]) -> None:
        if len(self._names) >= MAX_LAYERS:
            raise ValueError("too many layers")
        self._codec = layer(self._codec)
        self._names.append(name)
