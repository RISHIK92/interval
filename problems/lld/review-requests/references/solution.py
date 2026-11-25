from __future__ import annotations


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("ids and names are not empty")


class _PullRequest:
    def __init__(self, author: str) -> None:
        self.author = author
        self.requested: set[str] = set()
        self.approved: set[str] = set()


class ReviewQueue:
    """Pull requests and people are associated, never owned: a pull request holds the
    names of its author and reviewers, and each reviewer's queue holds pull request ids."""

    def __init__(self) -> None:
        self._prs: dict[str, _PullRequest] = {}
        self._pending: dict[str, list[str]] = {}
        self._owners: list[tuple[str, str]] = []

    def _get(self, pr: str) -> _PullRequest:
        found = self._prs.get(pr)
        if found is None:
            raise ValueError("unknown pull request")
        return found

    def open(self, pr: str, author: str) -> None:
        _named(pr, author)
        if pr in self._prs:
            raise ValueError("pull request already opened")
        self._prs[pr] = _PullRequest(author)

    def request(self, pr: str, reviewer: str) -> bool:
        _named(pr, reviewer)
        found = self._get(pr)
        if reviewer == found.author or reviewer in found.requested:
            return False
        found.requested.add(reviewer)
        self._pending.setdefault(reviewer, []).append(pr)
        return True

    def approve(self, pr: str, reviewer: str) -> bool:
        _named(pr, reviewer)
        found = self._get(pr)
        if reviewer not in found.requested or reviewer in found.approved:
            return False
        found.approved.add(reviewer)
        self._pending[reviewer].remove(pr)
        return True

    def pendingFor(self, reviewer: str) -> list[str]:
        _named(reviewer)
        return list(self._pending.get(reviewer, []))

    def approvals(self, pr: str) -> int:
        _named(pr)
        return len(self._get(pr).approved)

    # The extension round: owners of a path prefix are requested when it's touched.
    def codeowner(self, pathPrefix: str, reviewer: str) -> None:
        _named(pathPrefix, reviewer)
        if (pathPrefix, reviewer) not in self._owners:
            self._owners.append((pathPrefix, reviewer))

    def touch(self, pr: str, path: str) -> int:
        _named(pr, path)
        self._get(pr)
        added = 0
        for prefix, reviewer in self._owners:
            if path.startswith(prefix) and self.request(pr, reviewer):
                added += 1
        return added
