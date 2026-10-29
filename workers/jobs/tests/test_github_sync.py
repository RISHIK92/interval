"""A connected user's repositories read by the App (§5H, ADR-0024, P2-W12-S02), on
fakes: metadata and dependency names, never code."""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime

import pytest

from interval_db.messages import GithubSync
from interval_jobs.adapters.memory import InMemoryStore, StoredGitHub
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.github.sync import MAX_REPOS, enqueue_syncs, sync_user
from interval_jobs.pipeline import Pipeline, StageServices
from interval_jobs.ports import (
    Delivery,
    GitHubError,
    GitHubGone,
    GitHubRepo,
    RepoRead,
    Store,
)

from .test_pipeline import web

PUSHED = datetime(2026, 10, 1, tzinfo=UTC)


def repo(
    repo_id: int, name: str, *, fork: bool = False, archived: bool = False
) -> GitHubRepo:
    return GitHubRepo(repo_id, name, "An API", "main", PUSHED, fork, archived)


class FakeApp:
    """Installations with their repositories, trees and files; or failures."""

    def __init__(self) -> None:
        self.repos: dict[int, list[GitHubRepo]] = {}
        self.trees: dict[str, list[tuple[str, str]]] = {}
        self.blobs: dict[str, str] = {}
        self.gone: set[int] = set()
        self.rate_limited = False
        self.read: list[str] = []  # blobs fetched

    def installation_token(self, installation_id: int) -> str:
        if installation_id in self.gone:
            raise GitHubGone(f"installation {installation_id}")
        if self.rate_limited:
            raise GitHubError("rate limited")
        return f"tok-{installation_id}"

    def repositories(self, token: str) -> list[GitHubRepo]:
        return self.repos[int(token.removeprefix("tok-"))]

    def languages(self, token: str, full_name: str) -> list[str]:
        return ["TypeScript", "Go"]

    def tree(
        self, token: str, full_name: str, ref: str
    ) -> tuple[list[tuple[str, str]], bool]:
        return self.trees.get(full_name, []), False

    def blob(self, token: str, full_name: str, sha: str) -> str:
        self.read.append(sha)
        return self.blobs[sha]


def world() -> tuple[InMemoryStore, FakeApp]:
    store, app = InMemoryStore(), FakeApp()
    store.github.accounts["u1"] = StoredGitHub(installations=[(11, "octo")])
    app.repos[11] = [repo(1, "octo/api")]
    app.trees["octo/api"] = [
        ("package.json", "s1"),
        ("web/package.json", "s2"),
        ("packages/ui/package.json", "s3"),  # two levels down: not read
        ("package-lock.json", "s4"),
        ("src/index.ts", "s5"),  # code: never read
    ]
    app.blobs = {
        "s1": '{"dependencies": {"pg": "8"}, "devDependencies": {"vitest": "5"}}',
        "s2": '{"dependencies": {"react": "19"}}',
    }
    return store, app


def run(store: InMemoryStore, app: FakeApp) -> int | None:
    @contextmanager
    def stores() -> Generator[Store]:
        yield store

    return sync_user(stores, app, "u1")


def test_repositories_languages_and_dependency_names_are_saved_never_code() -> None:
    store, app = world()
    assert run(store, app) == 1
    saved = store.github.accounts["u1"]
    (read,) = saved.repos
    assert (read.repo.full_name, read.languages) == ("octo/api", ["TypeScript", "Go"])
    assert {(d.name, d.path, d.dev) for d in read.dependencies} == {
        ("pg", "package.json", False),
        ("vitest", "package.json", True),
        ("react", "web/package.json", False),
    }
    assert app.read == ["s1", "s2"]  # only dependency files, never s3, s4 or code
    assert saved.synced


def test_forks_and_archived_are_skipped_and_an_organisation_keeps_only_reachable() -> (
    None
):
    store, app = world()
    store.github.accounts["u1"] = StoredGitHub(
        installations=[(11, "octo"), (12, "acme"), (13, "friend")],
        reachable={12: frozenset({21}), 13: frozenset({31})},
    )
    app.repos[11] = [
        repo(1, "octo/api"),
        repo(2, "octo/fork", fork=True),
        repo(3, "octo/old", archived=True),
    ]
    app.repos[12] = [repo(21, "acme/seen"), repo(22, "acme/hidden")]
    # A personal account they only collaborate on: also just what they can reach.
    app.repos[13] = [repo(31, "friend/shared"), repo(32, "friend/private")]
    run(store, app)
    assert {r.repo.full_name for r in store.github.accounts["u1"].repos} == {
        "octo/api",
        "acme/seen",
        "friend/shared",
    }


def test_a_second_read_replaces_the_first_and_an_uninstalled_installation_goes() -> (
    None
):
    store, app = world()
    run(store, app)
    app.repos[11] = [repo(4, "octo/new")]
    run(store, app)
    assert [r.repo.full_name for r in store.github.accounts["u1"].repos] == ["octo/new"]
    app.gone.add(11)
    run(store, app)
    assert store.github.accounts["u1"].repos == []


def test_a_rate_limit_raises_for_the_queue_to_retry_and_saves_nothing() -> None:
    store, app = world()
    app.rate_limited = True
    with pytest.raises(GitHubError):
        run(store, app)
    assert not store.github.accounts["u1"].synced


def test_a_user_no_longer_connected_is_skipped() -> None:
    store, app = world()
    del store.github.accounts["u1"]
    assert run(store, app) is None


def test_reads_are_capped() -> None:
    store, app = world()
    app.repos[11] = [repo(n, f"octo/r{n}") for n in range(MAX_REPOS + 5)]
    assert run(store, app) == MAX_REPOS


def test_the_stage_reads_and_without_the_app_skips_rather_than_retrying() -> None:
    store, app = world()

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    message = GithubSync(user_id="u1")
    delivery = Delivery(attempt=1, idempotency_key="github-sync-u1-1")
    Pipeline(unit, InMemoryQueue()).handlers()["github_sync"](message, delivery)
    assert not store.github.accounts["u1"].synced
    Pipeline(unit, InMemoryQueue(), github=app).handlers()["github_sync"](
        message, delivery
    )
    assert store.github.accounts["u1"].synced


def test_a_sync_queues_a_recompute_so_project_picks_follow_it() -> None:
    store, app = world()

    @contextmanager
    def unit() -> Generator[StageServices]:
        yield StageServices(store, web(), TrafilaturaExtractor())

    queue = InMemoryQueue()
    Pipeline(unit, queue, github=app).handlers()["github_sync"](
        GithubSync(user_id="u1"),
        Delivery(attempt=1, idempotency_key="github-sync-u1-1"),
    )
    assert queue.pending_messages("recompute_feed") == [
        ("recompute-github-sync-u1-1", {"user_id": "u1"})
    ]


def test_the_daily_run_queues_active_connected_users_once_a_day() -> None:
    store, _ = world()
    store.github.accounts["u2"] = StoredGitHub(installations=[], active=False)
    queue = InMemoryQueue()
    assert enqueue_syncs(store, queue, datetime(2026, 10, 29, 3, tzinfo=UTC)) == 1
    assert queue.pending_messages("github_sync") == [
        ("github-sync-u1-20261029", {"user_id": "u1"})
    ]


def test_an_installation_gone_while_listed_is_skipped_not_retried() -> None:
    store, app = world()

    def gone(token: str) -> list[GitHubRepo]:
        raise GitHubGone("installation removed")

    app.repositories = gone  # type: ignore[method-assign]
    assert run(store, app) == 0
    assert store.github.accounts["u1"].synced


def test_a_save_keeps_only_what_is_still_allowed_after_a_reconnect() -> None:
    store, app = world()
    store.github.accounts["u1"] = StoredGitHub(
        installations=[(11, "octo"), (12, "acme")], reachable={12: frozenset({21})}
    )
    app.repos[12] = [repo(21, "acme/seen")]
    real_save = store.github.save_sync

    def reconnect_then_save(user_id: str, repos: list[RepoRead]) -> None:
        # Reconnected while GitHub was read: acme/seen no longer reachable.
        store.github.accounts["u1"].reachable = {12: frozenset()}
        real_save(user_id, repos)

    store.github.save_sync = reconnect_then_save  # type: ignore[method-assign]
    run(store, app)
    assert [r.repo.full_name for r in store.github.accounts["u1"].repos] == ["octo/api"]
