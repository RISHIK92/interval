"""Dependency files read for their dependency names (§5H, Q-P2-41, P2-W12-S02).
go.mod's `// indirect` requirements are left out (transitive, out of scope).

package.json, requirements.txt, pyproject.toml and go.mod, at a repository's root or
one directory down; lockfiles are not dependency files here. Only names (and whether
a dependency is for development) are kept: never versions or anything else in the
file. A file that doesn't parse gives nothing."""

import json
import re
import tomllib
from dataclasses import dataclass
from typing import Literal, cast

from interval_jobs import log

type Ecosystem = Literal["npm", "pypi", "go"]

_FILES: dict[str, Ecosystem] = {
    "package.json": "npm",
    "requirements.txt": "pypi",
    "pyproject.toml": "pypi",
    "go.mod": "go",
}
# Vendored code isn't the repository's own stack.
_SKIP_DIRS = {"node_modules", "vendor", ".git"}
# A requirement's name, before any extras, version, marker or URL.
_REQUIREMENT = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


@dataclass(frozen=True)
class Dependency:
    ecosystem: Ecosystem
    name: str
    path: str  # the file it came from
    dev: bool


def is_manifest(path: str) -> bool:
    parts = path.split("/")
    return (
        len(parts) <= 2 and parts[-1] in _FILES and not (set(parts[:-1]) & _SKIP_DIRS)
    )


def pypi_name(name: str) -> str:
    """PEP 503: case and runs of -_. don't matter."""
    return re.sub(r"[-_.]+", "-", name).lower()


def parse(path: str, text: str) -> list[Dependency]:
    file = path.rsplit("/", 1)[-1]
    try:
        found = _PARSERS[file](text)
    except (ValueError, TypeError, AttributeError) as error:
        log.info("github: a dependency file didn't parse", path=path, error=str(error))
        return []
    ecosystem = _FILES[file]
    seen: dict[str, bool] = {}
    for name, dev in found:
        key = pypi_name(name) if ecosystem == "pypi" else name
        # Listed as both: it's a runtime dependency.
        seen[key] = seen.get(key, True) and dev
    return [Dependency(ecosystem, name, path, dev) for name, dev in seen.items()]


def _package_json(text: str) -> list[tuple[str, bool]]:
    data: object = json.loads(text)
    if not isinstance(data, dict):
        raise TypeError("not an object")
    fields = cast(dict[str, object], data)
    out: list[tuple[str, bool]] = []
    for field, dev in (("dependencies", False), ("devDependencies", True)):
        deps = fields.get(field)
        if isinstance(deps, dict):
            out += [(name, dev) for name in cast(dict[str, object], deps)]
    return out


def _requirement(line: str) -> str | None:
    line = line.split("#", 1)[0].strip()
    if not line or line.startswith("-"):
        return None
    match = _REQUIREMENT.match(line)
    # A bare URL has no name; "name @ https://..." does.
    if match is None or line[match.end() :].startswith(("://", ":")):
        return None
    return match.group(1)


def _requirements_txt(text: str) -> list[tuple[str, bool]]:
    return [(name, False) for line in text.splitlines() if (name := _requirement(line))]


def _pyproject(text: str) -> list[tuple[str, bool]]:
    data = tomllib.loads(text)
    out: list[tuple[str, bool]] = []
    project = data.get("project", {})
    deps = project.get("dependencies", [])
    if not isinstance(deps, list):
        raise TypeError("project.dependencies isn't a list")
    out += [
        (n, False)
        for spec in cast(list[object], deps)
        if (n := _requirement(str(spec)))
    ]
    for group in project.get("optional-dependencies", {}).values():
        if isinstance(group, list):
            specs = cast(list[object], group)
            out += [(n, True) for spec in specs if (n := _requirement(str(spec)))]
    poetry = data.get("tool", {}).get("poetry", {})
    out += [(n, False) for n in poetry.get("dependencies", {}) if n != "python"]
    out += [(n, True) for n in poetry.get("dev-dependencies", {})]
    for group in poetry.get("group", {}).values():
        out += [(n, True) for n in group.get("dependencies", {})]
    return out


def _go_mod(text: str) -> list[tuple[str, bool]]:
    out: list[tuple[str, bool]] = []
    block = False
    for raw in text.splitlines():
        # An indirect requirement is someone else's dependency, not this stack's.
        if "// indirect" in raw:
            continue
        line = raw.split("//", 1)[0].strip()
        if line.startswith("require ("):
            block = True
        elif block and line == ")":
            block = False
        elif block and line:
            out.append((line.split()[0], False))
        elif line.startswith("require "):
            out.append((line.split()[1], False))
    return out


_PARSERS = {
    "package.json": _package_json,
    "requirements.txt": _requirements_txt,
    "pyproject.toml": _pyproject,
    "go.mod": _go_mod,
}
