"""Dependency files read for their dependency names only (§5H, Q-P2-41, P2-W12-S02)."""

import pytest

from interval_jobs.github.manifests import (
    Dependency,
    is_manifest,
    parse,
    pypi_name,
)


def names(path: str, text: str) -> set[tuple[str, str, bool]]:
    return {(d.ecosystem, d.name, d.dev) for d in parse(path, text)}


def test_package_json_dependencies_and_dev_dependencies() -> None:
    text = """{"name": "api", "dependencies": {"pg": "^8", "@nestjs/core": "10"},
    "devDependencies": {"vitest": "5"}, "peerDependencies": {"react": "19"}}"""
    assert names("package.json", text) == {
        ("npm", "pg", False),
        ("npm", "@nestjs/core", False),
        ("npm", "vitest", True),
    }


def test_requirements_txt_names_only() -> None:
    text = """
# web
Django>=5.0  # the framework
psycopg[binary]==3.2 ; python_version >= "3.11"
-r base.txt
-e git+https://github.com/x/y.git#egg=y
https://example.test/pkg.whl
redis
Flask_SQLAlchemy
mylib @ https://example.test/mylib-1.0.tar.gz
"""
    assert names("services/api/requirements.txt", text) == {
        ("pypi", "django", False),
        ("pypi", "psycopg", False),
        ("pypi", "redis", False),
        ("pypi", "flask-sqlalchemy", False),
        ("pypi", "mylib", False),
    }


def test_pyproject_pep_621_and_poetry() -> None:
    pep621 = """
[project]
dependencies = ["fastapi>=0.110", "SQLAlchemy[asyncio]~=2.0"]
[project.optional-dependencies]
test = ["pytest"]
"""
    assert names("pyproject.toml", pep621) == {
        ("pypi", "fastapi", False),
        ("pypi", "sqlalchemy", False),
        ("pypi", "pytest", True),
    }
    poetry = """
[tool.poetry.dependencies]
python = "^3.12"
celery = {version = "^5", extras = ["redis"]}
[tool.poetry.group.dev.dependencies]
ruff = "*"
[tool.poetry.dev-dependencies]
mypy = "*"
"""
    assert names("pyproject.toml", poetry) == {
        ("pypi", "celery", False),
        ("pypi", "ruff", True),
        ("pypi", "mypy", True),
    }


def test_go_mod_direct_requirements_only() -> None:
    text = """module example.com/api

go 1.23

require github.com/jackc/pgx/v5 v5.6.0

require (
\tgithub.com/redis/go-redis/v9 v9.5.1
\tgolang.org/x/sync v0.7.0 // indirect
)
"""
    assert names("go.mod", text) == {
        ("go", "github.com/jackc/pgx/v5", False),
        ("go", "github.com/redis/go-redis/v9", False),
    }  # golang.org/x/sync is indirect: someone else's dependency


@pytest.mark.parametrize(
    ("path", "text"),
    [
        ("package.json", "{not json"),
        ("package.json", '["a list"]'),
        ("pyproject.toml", "[project\nbroken"),
        ("pyproject.toml", '[project]\ndependencies = "fastapi"'),
    ],
)
def test_a_file_that_does_not_parse_gives_nothing(path: str, text: str) -> None:
    assert parse(path, text) == []


def test_which_paths_count_root_and_one_level_down_no_lockfiles() -> None:
    assert is_manifest("package.json")
    assert is_manifest("web/package.json")
    assert is_manifest("services/requirements.txt")
    assert not is_manifest("packages/ui/package.json")  # two levels down
    assert not is_manifest("package-lock.json")
    assert not is_manifest("poetry.lock")
    assert not is_manifest("go.sum")
    assert not is_manifest("node_modules/pg/package.json")
    assert not is_manifest("README.md")


def test_pypi_names_are_normalised_per_pep_503() -> None:
    assert pypi_name("Flask_SQLAlchemy") == "flask-sqlalchemy"
    assert pypi_name("zope.interface") == "zope-interface"


def test_a_dependency_remembers_its_file() -> None:
    (dep,) = parse("api/go.mod", "module x\nrequire a.b/c v1\n")
    assert dep == Dependency("go", "a.b/c", "api/go.mod", False)
