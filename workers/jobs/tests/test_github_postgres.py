"""PostgresGitHub (P2-W12-S02) on the real schema: what the sync reads and writes."""

from datetime import UTC, datetime

import psycopg

from interval_jobs.adapters.postgres import PostgresGitHub
from interval_jobs.github.manifests import Dependency
from interval_jobs.ports import GitHubRepo, RepoRead

from .test_db_guards import a_user

PUSHED = datetime(2026, 10, 1, tzinfo=UTC)


def connected(conn: psycopg.Connection, user_id: str, github_id: int) -> None:
    a_user(conn, user_id)
    conn.execute(
        "insert into github_account (user_id, github_user_id, login) "
        "values (%s, %s, 'o')",
        (user_id, github_id),
    )
    conn.execute(
        "insert into github_installation values (%s, 11, 'o', 'User'), "
        "(%s, 12, 'acme', 'Organization')",
        (user_id, user_id),
    )
    conn.execute(
        "insert into github_reachable_repository values (%s, 12, 21), (%s, 12, 22)",
        (user_id, user_id),
    )


def read(repo_id: int, name: str, deps: list[Dependency]) -> RepoRead:
    repo = GitHubRepo(repo_id, name, "An API", "main", PUSHED, False, False)
    return RepoRead(11, repo, ["TypeScript"], deps)


def test_sync_input_names_installations_and_an_organisations_reachable_repos(
    conn: psycopg.Connection,
) -> None:
    github = PostgresGitHub(conn)
    connected(conn, "gh1", 9_100_000_001)
    wanted = github.sync_input("gh1")
    assert wanted is not None
    assert wanted.login == "o"
    assert wanted.installations == [(11, "o"), (12, "acme")]
    assert wanted.reachable == {12: frozenset({21, 22})}
    assert github.sync_input("nobody") is None


def test_a_sync_replaces_repositories_and_dependencies_and_marks_the_read(
    conn: psycopg.Connection,
) -> None:
    github = PostgresGitHub(conn)
    connected(conn, "gh2", 9_100_000_002)
    pg = Dependency("npm", "pg", "package.json", False)
    github.save_sync(
        "gh2",
        [
            read(1, "o/api", [pg, Dependency("npm", "pg", "web/package.json", True)]),
            read(2, "o/web", []),
        ],
    )
    rows = conn.execute(
        "select r.full_name, r.languages, d.name, d.dev from github_repository r "
        "left join github_dependency d using (user_id, repo_id) "
        "where r.user_id = 'gh2' order by r.repo_id"
    ).fetchall()
    # Listed in two files of one repository: one row, a runtime dependency.
    assert rows == [
        ("o/api", ["TypeScript"], "pg", False),
        ("o/web", ["TypeScript"], None, None),
    ]
    stamp = conn.execute(
        "select synced_at is not null from github_account where user_id = 'gh2'"
    ).fetchone()
    assert stamp == (True,)
    github.save_sync("gh2", [read(3, "o/new", [])])
    assert conn.execute(
        "select repo_id from github_repository where user_id = 'gh2'"
    ).fetchall() == [(3,)]
    assert conn.execute(
        "select count(*) from github_dependency where user_id = 'gh2'"
    ).fetchone() == (0,)


def test_disconnecting_takes_everything_and_a_late_save_stores_nothing(
    conn: psycopg.Connection,
) -> None:
    github = PostgresGitHub(conn)
    connected(conn, "gh3", 9_100_000_003)
    github.save_sync(
        "gh3", [read(1, "o/api", [Dependency("go", "a/b", "go.mod", False)])]
    )
    conn.execute("delete from github_account where user_id = 'gh3'")
    for table in (
        "github_repository",
        "github_dependency",
        "github_reachable_repository",
    ):
        assert conn.execute(
            f"select count(*) from {table} where user_id = 'gh3'"
        ).fetchone() == (0,)
    github.save_sync("gh3", [read(1, "o/api", [])])
    assert conn.execute(
        "select count(*) from github_repository where user_id = 'gh3'"
    ).fetchone() == (0,)


def test_due_are_connected_users_with_a_session_this_week(
    conn: psycopg.Connection,
) -> None:
    github = PostgresGitHub(conn)
    connected(conn, "gh4", 9_100_000_004)
    connected(conn, "gh5", 9_100_000_005)
    for user_id, age in (("gh4", "1 day"), ("gh5", "10 days")):
        conn.execute(
            "insert into auth_session (id, expires_at, token, updated_at, user_id) "
            "values (%s, now() + interval '1 day', %s, now() - %s::interval, %s)",
            (f"{user_id}-s", f"{user_id}-t", age, user_id),
        )
    due = github.due_for_sync(7)
    assert "gh4" in due and "gh5" not in due


def test_a_save_drops_what_the_user_can_no_longer_reach(
    conn: psycopg.Connection,
) -> None:
    github = PostgresGitHub(conn)
    connected(conn, "gh6", 9_100_000_006)
    org_repo = GitHubRepo(23, "acme/hidden", None, "main", PUSHED, False, False)
    github.save_sync("gh6", [read(1, "o/api", []), RepoRead(12, org_repo, [], [])])
    assert conn.execute(
        "select repo_id from github_repository where user_id = 'gh6' order by 1"
    ).fetchall() == [(1,)]
