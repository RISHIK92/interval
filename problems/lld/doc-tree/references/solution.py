from __future__ import annotations

KEY_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
DIGITS = set("0123456789")

# A path is a list of segments: a key (str) steps into an object, an index (int) into an
# array.
Segment = str | int


def _key(text: str) -> str:
    if text == "" or any(c not in KEY_CHARS for c in text):
        raise ValueError("not a key")
    return text


def _index(text: str) -> int:
    if text == "" or any(c not in DIGITS for c in text):
        raise ValueError("not an index")
    if text[0] == "0" and text != "0":
        raise ValueError("not an index")
    return int(text)


def _parse(path: str) -> list[Segment]:
    if path == "":
        return []
    segments: list[Segment] = []
    for part in path.split("."):
        key, *indexes = part.split("[")
        segments.append(_key(key))
        for piece in indexes:
            if not piece.endswith("]"):
                raise ValueError("an unclosed [")
            segments.append(_index(piece[:-1]))
    return segments


def _join(at: str, segment: Segment) -> str:
    if isinstance(segment, int):
        return f"{at}[{segment}]"
    return segment if at == "" else f"{at}.{segment}"


# The composite: scalars, objects and arrays answer the same questions, and a branch
# answers by asking its children.
class Scalar:
    def __init__(self, value: str) -> None:
        self.value = value

    def child(self, segment: Segment) -> Node | None:
        return None

    def summary(self) -> str:
        return self.value

    def size(self) -> int:
        return 0

    def leaves(self, at: str) -> list[str]:
        return [at]


class ObjectNode:
    def __init__(self) -> None:
        self.children: dict[str, Node] = {}

    def child(self, segment: Segment) -> Node | None:
        return self.children.get(segment) if isinstance(segment, str) else None

    def room(self, segment: Segment) -> bool:
        return isinstance(segment, str)

    def attach(self, segment: Segment, node: Node) -> None:
        self.children[str(segment)] = node

    def detach(self, segment: Segment) -> None:
        del self.children[str(segment)]

    def summary(self) -> str:
        return f"object({len(self.children)})"

    def size(self) -> int:
        return sum(1 + child.size() for child in self.children.values())

    def leaves(self, at: str) -> list[str]:
        out: list[str] = []
        for key in sorted(self.children):
            out += self.children[key].leaves(_join(at, key))
        return out


class ArrayNode:
    def __init__(self) -> None:
        self.items: list[Node] = []

    def child(self, segment: Segment) -> Node | None:
        if isinstance(segment, int) and segment < len(self.items):
            return self.items[segment]
        return None

    def room(self, segment: Segment) -> bool:
        # An array only grows at its end.
        return isinstance(segment, int) and segment == len(self.items)

    def attach(self, segment: Segment, node: Node) -> None:
        self.items.append(node)

    def detach(self, segment: Segment) -> None:
        self.items.pop(int(segment))

    def summary(self) -> str:
        return f"array({len(self.items)})"

    def size(self) -> int:
        return sum(1 + item.size() for item in self.items)

    def leaves(self, at: str) -> list[str]:
        out: list[str] = []
        for i, item in enumerate(self.items):
            out += item.leaves(_join(at, i))
        return out


Node = Scalar | ObjectNode | ArrayNode


class DocTree:
    def __init__(self) -> None:
        self._root = ObjectNode()

    def put(self, path: str, val: str) -> bool:
        segments = _parse(path)
        if not segments or val == "":
            raise ValueError("the root can't be a scalar, and a value isn't empty")
        node, rest = self._walk(segments)
        if rest:
            return self._grow(node, rest, Scalar(val))
        if not isinstance(node, Scalar):
            return False
        node.value = val
        return True

    def read(self, path: str) -> str | None:
        node = self._find(_parse(path))
        return None if node is None else node.summary()

    def remove(self, path: str) -> bool:
        segments = _parse(path)
        if not segments:
            raise ValueError("the root stays")
        parent = self._find(segments[:-1])
        if parent is None or parent.child(segments[-1]) is None:
            return False
        assert not isinstance(parent, Scalar)
        parent.detach(segments[-1])
        return True

    def paths(self, prefix: str) -> list[str]:
        node = self._find(_parse(prefix))
        return [] if node is None else node.leaves(prefix)

    def count(self, path: str) -> int:
        node = self._find(_parse(path))
        if node is None:
            raise KeyError("no such node")
        return node.size()

    # The extension round: a shallow merge of scalars into one object.
    def merge(self, path: str, entries: dict[str, str]) -> int:
        segments = _parse(path)
        for key, value in entries.items():
            _key(key)
            if value == "":
                raise ValueError("an empty value")
        node, rest = self._walk(segments)
        if rest:
            made = ObjectNode()
            if not self._grow(node, rest, made):
                raise ValueError("the path can't be made")
            node = made
        if not isinstance(node, ObjectNode):
            raise ValueError("only an object can be merged into")
        changed = 0
        for key, value in entries.items():
            old = node.child(key)
            if isinstance(old, Scalar) and old.value == value:
                continue
            node.attach(key, Scalar(value))
            changed += 1
        return changed

    def _walk(self, segments: list[Segment]) -> tuple[Node, list[Segment]]:
        """Follows the path as far as it exists: the last node reached and the
        segments still to go."""
        node: Node = self._root
        for i, segment in enumerate(segments):
            child = node.child(segment)
            if child is None:
                return node, segments[i:]
            node = child
        return node, []

    def _find(self, segments: list[Segment]) -> Node | None:
        node, rest = self._walk(segments)
        return None if rest else node

    @staticmethod
    def _grow(parent: Node, rest: list[Segment], leaf: Node) -> bool:
        """Creates the missing part of a path, each new branch an object or an array as
        the segment after it needs, or refuses without changing anything."""
        if isinstance(parent, Scalar) or not parent.room(rest[0]):
            return False
        # Every array made here is new and empty, so it can only take index 0.
        if any(isinstance(s, int) and s != 0 for s in rest[1:]):
            return False
        for i in range(len(rest) - 1):
            made: ObjectNode | ArrayNode = (
                ObjectNode() if isinstance(rest[i + 1], str) else ArrayNode()
            )
            parent.attach(rest[i], made)
            parent = made
        parent.attach(rest[-1], leaf)
        return True
