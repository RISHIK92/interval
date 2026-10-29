"""Interval's GitHub App over HTTP (ADR-0024, P2-W12-S02): installation tokens from the
App's JWT, then each repository's metadata, file paths and dependency files' blobs.
Answers are checked at the boundary; 404 means gone, a rate limit or 5xx is retried."""

import base64
from collections.abc import Callable
from datetime import UTC, datetime
from urllib.parse import quote

import httpx
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import BaseModel, TypeAdapter

from interval_jobs.github.app_token import app_jwt
from interval_jobs.ports import GitHubError, GitHubGone, GitHubRepo

API = "https://api.github.com"
TIMEOUT_SECONDS = 20.0
HEADERS = {
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
}


class _Token(BaseModel):
    token: str


class _Repo(BaseModel):
    id: int
    full_name: str
    description: str | None = None
    default_branch: str
    pushed_at: datetime | None = None
    fork: bool = False
    archived: bool = False


class _Repos(BaseModel):
    repositories: list[_Repo]


class _Entry(BaseModel):
    path: str
    type: str
    sha: str
    size: int = 0


# A dependency file is a few kilobytes; anything far larger isn't read.
MAX_BLOB_BYTES = 1_000_000


class _Tree(BaseModel):
    tree: list[_Entry]
    truncated: bool = False


_LANGUAGES = TypeAdapter(dict[str, int])


class _Blob(BaseModel):
    content: str
    encoding: str


class HttpGitHubApp:
    def __init__(
        self,
        app_id: str,
        key: rsa.RSAPrivateKey,
        client: httpx.Client | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._app_id = app_id
        self._key = key
        self._client = client or httpx.Client(timeout=TIMEOUT_SECONDS)
        self._clock = clock

    def _send(
        self, method: str, url: str, bearer: str, allow: frozenset[int] = frozenset()
    ) -> httpx.Response:
        response = self._client.request(
            method, url, headers={**HEADERS, "authorization": f"Bearer {bearer}"}
        )
        if response.status_code in allow:
            return response
        limited = (
            response.headers.get("x-ratelimit-remaining") == "0"
            or "retry-after" in response.headers
        )
        if response.status_code == 429 or (response.status_code == 403 and limited):
            raise GitHubError(f"github: rate limited ({url})")
        # Gone, suspended, blocked or under a legal hold: that installation or
        # repository is left out; the rest are still read.
        if response.status_code in (403, 404, 451):
            raise GitHubGone(f"{url} answered {response.status_code}")
        if response.status_code >= 400:
            raise GitHubError(f"github: {url} answered {response.status_code}")
        return response

    def installation_token(self, installation_id: int) -> str:
        jwt = app_jwt(self._app_id, self._key, self._clock())
        url = f"{API}/app/installations/{installation_id}/access_tokens"
        return _Token.model_validate(self._send("POST", url, jwt).json()).token

    def repositories(self, token: str) -> list[GitHubRepo]:
        repos: list[GitHubRepo] = []
        url: str | None = f"{API}/installation/repositories?per_page=100"
        while url is not None:
            response = self._send("GET", url, token)
            repos += [
                GitHubRepo(
                    r.id,
                    r.full_name,
                    r.description,
                    r.default_branch,
                    r.pushed_at,
                    r.fork,
                    r.archived,
                )
                for r in _Repos.model_validate(response.json()).repositories
            ]
            next_link = response.links.get("next")
            url = None if next_link is None else next_link.get("url")
        return repos

    def languages(self, token: str, full_name: str) -> list[str]:
        response = self._send("GET", f"{API}/repos/{full_name}/languages", token)
        sizes = _LANGUAGES.validate_python(response.json())
        return sorted(sizes, key=lambda lang: sizes[lang], reverse=True)

    def tree(
        self, token: str, full_name: str, ref: str
    ) -> tuple[list[tuple[str, str]], bool]:
        url = f"{API}/repos/{full_name}/git/trees/{quote(ref, safe='')}?recursive=1"
        response = self._send("GET", url, token, allow=frozenset({409}))
        if response.status_code == 409:  # an empty repository has no tree
            return [], False
        tree = _Tree.model_validate(response.json())
        return [
            (e.path, e.sha)
            for e in tree.tree
            if e.type == "blob" and e.size <= MAX_BLOB_BYTES
        ], tree.truncated

    def blob(self, token: str, full_name: str, sha: str) -> str:
        url = f"{API}/repos/{full_name}/git/blobs/{sha}"
        blob = _Blob.model_validate(self._send("GET", url, token).json())
        if blob.encoding != "base64":
            raise GitHubError(f"github: blob {sha} isn't base64")
        return base64.b64decode(blob.content).decode("utf-8", errors="replace")
