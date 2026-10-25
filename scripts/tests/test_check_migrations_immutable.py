import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "check-migrations-immutable.sh"
MIGRATIONS = Path("packages/db/migrations")


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> tuple[Path, str]:
    git(tmp_path, "init", "-q", "-b", "main")
    git(tmp_path, "config", "user.email", "t@example.test")
    git(tmp_path, "config", "user.name", "t")
    (tmp_path / MIGRATIONS).mkdir(parents=True)
    (tmp_path / MIGRATIONS / "001_init.sql").write_text("-- migrate:up\n")
    (tmp_path / "README.md").write_text("x\n")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-q", "-m", "base")
    return tmp_path, git(tmp_path, "rev-parse", "HEAD")


def check(repo: Path, base: str) -> subprocess.CompletedProcess[str]:
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "change")
    return subprocess.run(
        [str(SCRIPT), base], cwd=repo, capture_output=True, text=True, check=False
    )


def test_new_migration_passes(repo: tuple[Path, str]) -> None:
    path, base = repo
    (path / MIGRATIONS / "002_more.sql").write_text("-- migrate:up\n")
    assert check(path, base).returncode == 0


def test_other_files_changing_passes(repo: tuple[Path, str]) -> None:
    path, base = repo
    (path / "README.md").write_text("y\n")
    assert check(path, base).returncode == 0


@pytest.mark.parametrize("change", ["modify", "delete", "rename"])
def test_changing_a_merged_migration_fails_and_names_it(
    repo: tuple[Path, str], change: str
) -> None:
    path, base = repo
    target = path / MIGRATIONS / "001_init.sql"
    if change == "modify":
        target.write_text("-- migrate:up\ncreate table x ();\n")
    elif change == "delete":
        target.unlink()
    else:
        target.rename(path / MIGRATIONS / "001_renamed.sql")
    result = check(path, base)
    assert result.returncode == 1
    assert "001_init.sql" in result.stderr
