"""ADR-0012: business logic depends only on ports. Drivers and SDKs live in adapters."""

import ast
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1] / "src" / "interval_jobs"
# Composition and the CLI wire adapters together, so they may import them.
WIRING = {PACKAGE / "compose.py", PACKAGE / "__main__.py"}
FORBIDDEN = {
    "psycopg",
    "httpx",
    "boto3",
    "botocore",
    "trafilatura",
    "lxml",
    "redis",
    "bullmq",
}


def imported_modules(source: str, package: list[str]) -> set[str]:
    """Every module a file imports: relative imports resolved against `package`, and
    each imported name included, so `from interval_jobs import adapters` counts."""
    modules: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            modules |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = package[: len(package) - (node.level - 1)]
                module = ".".join([*base, *([node.module] if node.module else [])])
            else:
                module = node.module or ""
            modules.add(module)
            modules |= {f"{module}.{alias.name}" for alias in node.names}
    return modules


def modules_of(path: Path) -> set[str]:
    package = ["interval_jobs", *path.relative_to(PACKAGE).parent.parts]
    return imported_modules(path.read_text(encoding="utf-8"), package)


def logic_modules() -> list[Path]:
    return [
        path
        for path in PACKAGE.rglob("*.py")
        if "adapters" not in path.relative_to(PACKAGE).parts and path not in WIRING
    ]


def test_logic_modules_import_no_driver_or_sdk() -> None:
    offenders = {
        str(path.relative_to(PACKAGE)): sorted(
            {m.split(".")[0] for m in modules_of(path)} & FORBIDDEN
        )
        for path in logic_modules()
    }
    assert {k: v for k, v in offenders.items() if v} == {}


def test_logic_does_not_import_adapters() -> None:
    offenders = [
        str(path.relative_to(PACKAGE))
        for path in logic_modules()
        if any(m.startswith("interval_jobs.adapters") for m in modules_of(path))
    ]
    assert offenders == []


def test_relative_and_package_imports_are_resolved() -> None:
    ingest = ["interval_jobs", "ingest"]
    assert "interval_jobs.adapters.postgres" in imported_modules(
        "from ..adapters import postgres\n", ingest
    )
    assert "interval_jobs.adapters" in imported_modules(
        "from interval_jobs import adapters\n", ingest
    )
    assert "interval_jobs.ingest.feed" in imported_modules(
        "from .feed import x\n", ingest
    )
