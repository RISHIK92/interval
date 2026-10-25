"""scripts/with-env.sh: loads the repo-root .env for local runs."""

import os
import shutil
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "with-env.sh"


def run_in_copy(tmp_path: Path, env_file: str, *command: str) -> str:
    # A copy of the script in a fake repo, so the real .env is never read.
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    shutil.copy(SCRIPT, repo / "scripts" / "with-env.sh")
    (repo / ".env").write_text(env_file, encoding="utf-8")
    result = subprocess.run(
        [str(repo / "scripts" / "with-env.sh"), *command],
        env={"PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def test_a_relative_events_dir_resolves_against_the_repo_root(tmp_path: Path) -> None:
    # Web runs from apps/web and the worker from the root; both must share one folder.
    out = run_in_copy(tmp_path, "EVENTS_DIR=.data/events\n", "printenv", "EVENTS_DIR")
    assert out.strip() == str((tmp_path / "repo" / ".data" / "events").resolve())


def test_an_absolute_events_dir_is_kept(tmp_path: Path) -> None:
    out = run_in_copy(tmp_path, "EVENTS_DIR=/var/events\n", "printenv", "EVENTS_DIR")
    assert out.strip() == "/var/events"
