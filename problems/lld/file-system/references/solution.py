from __future__ import annotations

import functools
import threading

def _locked(method):
    # One lock for the whole tree: mv touches two directories at once, and a lock per
    # directory would need an ordering to avoid deadlock.
    @functools.wraps(method)
    def run(self, *args):
        with self.lock:
            return method(self, *args)

    return run


class FileSystem:
    def __init__(self) -> None:
        self.root: dict = {}
        self.lock = threading.Lock()

    def _parts(self, path: str) -> list[str]:
        if not path.startswith("/"):
            raise ValueError("invalid path")
        out: list[str] = []
        for s in path.split("/"):
            if s in ("", "."):
                continue
            if s == "..":
                if not out:
                    raise ValueError("invalid path")
                out.pop()
            else:
                out.append(s)
        return out

    def _walk(self, parts: list[str]):
        node = self.root
        for p in parts:
            if not isinstance(node, dict):
                raise NotADirectoryError("not a directory")
            if p not in node:
                raise KeyError("not found")
            node = node[p]
        return node

    def _parent(self, parts: list[str]) -> tuple[dict, str]:
        if not parts:
            raise IsADirectoryError("is a directory")
        parent = self._walk(parts[:-1])
        if not isinstance(parent, dict):
            raise NotADirectoryError("not a directory")
        return parent, parts[-1]

    @_locked
    def mkdir(self, path: str) -> None:
        node = self.root
        for p in self._parts(path):
            if p not in node:
                node[p] = {}
            elif not isinstance(node[p], dict):
                raise FileExistsError("already exists")
            node = node[p]

    @_locked
    def write(self, path: str, text: str) -> None:
        parent, name = self._parent(self._parts(path))
        if isinstance(parent.get(name), dict):
            raise IsADirectoryError("is a directory")
        parent[name] = text

    @_locked
    def appendTo(self, path: str, text: str) -> None:
        parent, name = self._parent(self._parts(path))
        if isinstance(parent.get(name), dict):
            raise IsADirectoryError("is a directory")
        parent[name] = parent.get(name, "") + text

    @_locked
    def read(self, path: str) -> str:
        node = self._walk(self._parts(path))
        if isinstance(node, dict):
            raise IsADirectoryError("is a directory")
        return node

    @_locked
    def ls(self, path: str) -> list[str]:
        parts = self._parts(path)
        node = self._walk(parts)
        return sorted(node) if isinstance(node, dict) else [parts[-1]]

    @_locked
    def rm(self, path: str) -> None:
        parent, name = self._parent(self._parts(path))
        if name not in parent:
            raise KeyError("not found")
        if isinstance(parent[name], dict) and parent[name]:
            raise OSError("directory not empty")
        del parent[name]

    # The extension round.
    @_locked
    def mv(self, source: str, target: str) -> None:
        sp, tp = self._parts(source), self._parts(target)
        if not sp:
            raise ValueError("cannot move the root")
        node = self._walk(sp)
        if tp[: len(sp)] == sp:
            raise ValueError("cannot move into itself")
        tparent, tname = self._parent(tp)
        if tname in tparent:
            raise FileExistsError("already exists")
        sparent, sname = self._parent(sp)
        del sparent[sname]
        tparent[tname] = node

    @_locked
    def size(self, path: str) -> int:
        def total(node) -> int:
            if isinstance(node, dict):
                return sum(total(n) for n in node.values())
            return len(node)

        return total(self._walk(self._parts(path)))
