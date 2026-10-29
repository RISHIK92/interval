"""A connected user's repositories, read by Interval's GitHub App (§5H, ADR-0024,
P2-W12-S02): each repository's metadata, and the dependency names in its dependency
files. Never code: only file paths are looked at, and only dependency files are read.

Every GitHub call happens before the save, with no transaction open. A rate limit or
a failing GitHub raises for the queue to retry (LOAD-5); an installation or repository
the App can no longer reach is left out, so its rows go."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import datetime

from interval_jobs import log
from interval_jobs.github.manifests import is_manifest, parse
from interval_jobs.ports import (
    GitHubApp,
    GitHubGone,
    GitHubRepo,
    JobQueue,
    RepoRead,
    Store,
)

# Q-P2-40: a connected user active this week is read again daily.
ACTIVE_DAYS = 7
# A run stays bounded: a user's first 50 repositories, 20 dependency files each.
MAX_REPOS = 50
MAX_FILES = 20

type Stores = Callable[[], AbstractContextManager[Store]]


def sync_user(stores: Stores, app: GitHubApp, user_id: str) -> int | None:
    """The repositories read, or None when the user isn't connected."""
    with stores() as store:
        wanted = store.github.sync_input(user_id)
    if wanted is None:
        log.info("github: sync for a user not connected", user_id=user_id)
        return None
    reads: list[RepoRead] = []
    for installation_id, _ in wanted.installations:
        try:
            token = app.installation_token(installation_id)
            listed = app.repositories(token)
        except GitHubGone:
            log.info("github: installation gone", installation_id=installation_id)
            continue
        # On any account but their own, only what this user can reach (read with
        # their token at connect): the App sees every repository selected there.
        repos = [
            r
            for r in listed
            if not r.fork
            and not r.archived
            and wanted.allowed(installation_id, r.repo_id)
        ]
        for repo in repos:
            if len(reads) >= MAX_REPOS:
                log.warn("github: repositories capped", user_id=user_id, cap=MAX_REPOS)
                break
            try:
                reads.append(_read(app, token, installation_id, repo))
            except GitHubGone:
                log.info("github: repository gone", repo=repo.full_name)
    with stores() as store:
        store.github.save_sync(user_id, reads)
    log.info("github: synced", user_id=user_id, repositories=len(reads))
    return len(reads)


def _read(
    app: GitHubApp, token: str, installation_id: int, repo: GitHubRepo
) -> RepoRead:
    paths, truncated = app.tree(token, repo.full_name, repo.default_branch)
    if truncated:
        log.warn("github: tree truncated; some files missed", repo=repo.full_name)
    files = [(path, sha) for path, sha in paths if is_manifest(path)][:MAX_FILES]
    return RepoRead(
        installation_id,
        repo,
        app.languages(token, repo.full_name)[:5],
        [
            dependency
            for path, sha in files
            for dependency in parse(path, app.blob(token, repo.full_name, sha))
        ],
    )


def enqueue_syncs(store: Store, queue: JobQueue, now: datetime) -> int:
    """Q-P2-40: one read per connected user active this week. The key is per UTC day,
    so a run repeated the same day asks for the same job."""
    day = now.strftime("%Y%m%d")
    users = store.github.due_for_sync(ACTIVE_DAYS)
    for user_id in users:
        queue.enqueue(
            "github_sync",
            {"user_id": user_id},
            idempotency_key=f"github-sync-{user_id}-{day}",
        )
    return len(users)
