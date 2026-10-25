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


def run_check(
    repo: Path, base: str, mode: str = "pr"
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(SCRIPT), base, mode], cwd=repo, capture_output=True, text=True, check=False
    )


def commit_and_check(
    repo: Path, base: str, mode: str = "pr"
) -> subprocess.CompletedProcess[str]:
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "change")
    return run_check(repo, base, mode)


def test_new_migration_passes(repo: tuple[Path, str]) -> None:
    path, base = repo
    (path / MIGRATIONS / "002_more.sql").write_text("-- migrate:up\n")
    assert commit_and_check(path, base).returncode == 0


def test_other_files_changing_passes(repo: tuple[Path, str]) -> None:
    path, base = repo
    (path / "README.md").write_text("y\n")
    assert commit_and_check(path, base).returncode == 0


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
    result = commit_and_check(path, base)
    assert result.returncode == 1
    assert "001_init.sql" in result.stderr


def test_migration_added_on_main_after_branching_is_not_a_deletion(
    repo: tuple[Path, str],
) -> None:
    path, _ = repo
    git(path, "switch", "-q", "-c", "feature")
    (path / "README.md").write_text("feature\n")
    git(path, "commit", "-qam", "feature work")
    git(path, "switch", "-q", "main")
    (path / MIGRATIONS / "002_on_main.sql").write_text("-- migrate:up\n")
    git(path, "add", "-A")
    git(path, "commit", "-q", "-m", "main adds a migration")
    main_tip = git(path, "rev-parse", "HEAD")
    git(path, "switch", "-q", "feature")
    # Three-dot diff from the merge base: the branch lacking 002 is not a deletion.
    assert run_check(path, main_tip).returncode == 0


def test_unknown_base_fails_with_a_clear_message(repo: tuple[Path, str]) -> None:
    path, _ = repo
    result = run_check(path, "0123456789abcdef0123456789abcdef01234567", "push")
    assert result.returncode == 1
    assert "not found" in result.stderr


def test_push_whose_base_is_not_an_ancestor_fails(repo: tuple[Path, str]) -> None:
    path, base = repo
    (path / MIGRATIONS / "002_more.sql").write_text("-- migrate:up\n")
    git(path, "add", "-A")
    git(path, "commit", "-q", "-m", "ahead")
    ahead = git(path, "rev-parse", "HEAD")
    git(path, "reset", "-q", "--hard", base)  # main moved backwards: a force-push
    result = run_check(path, ahead, "push")
    assert result.returncode == 1
    assert "not an ancestor" in result.stderr
