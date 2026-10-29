"""The GitHub App over HTTP (ADR-0024, P2-W12-S02), against a stub transport."""

import base64
import json
from datetime import UTC, datetime

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from interval_jobs.adapters.http_github_app import HttpGitHubApp
from interval_jobs.ports import GitHubError, GitHubGone

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=UTC)
NEXT = "https://api.github.com/installation/repositories?page=2"


def app(handler: httpx.MockTransport) -> HttpGitHubApp:
    return HttpGitHubApp("123", KEY, httpx.Client(transport=handler), clock=lambda: NOW)


def test_an_installation_token_is_asked_for_with_the_apps_jwt() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(201, json={"token": "ghs_abc", "expires_at": "x"})

    assert app(httpx.MockTransport(handle)).installation_token(11) == "ghs_abc"
    (request,) = seen
    assert request.method == "POST"
    assert (
        str(request.url) == "https://api.github.com/app/installations/11/access_tokens"
    )
    assert request.headers["authorization"].startswith("Bearer ey")
    assert request.headers["x-github-api-version"] == "2022-11-28"


def test_repositories_page_on_languages_tree_and_blobs() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        url = request.url
        assert request.headers["authorization"] == "Bearer ghs_abc"
        if url.path == "/installation/repositories":
            page = url.params.get("page", "1")
            one = {
                "id": 1 if page == "1" else 2,
                "full_name": "octo/api" if page == "1" else "octo/web",
                "description": None,
                "default_branch": "main",
                "pushed_at": "2026-10-01T00:00:00Z",
                "fork": False,
                "archived": page == "2",
            }
            headers = {"link": f'<{NEXT}>; rel="next"'} if page == "1" else {}
            return httpx.Response(200, json={"repositories": [one]}, headers=headers)
        if url.path == "/repos/octo/api/languages":
            return httpx.Response(200, json={"Go": 10, "TypeScript": 900})
        if url.path == "/repos/octo/api/git/trees/main":
            assert url.params["recursive"] == "1"
            return httpx.Response(
                200,
                json={
                    "truncated": False,
                    "tree": [
                        {"path": "package.json", "type": "blob", "sha": "s1"},
                        {"path": "src", "type": "tree", "sha": "t1"},
                        # Far too big for a dependency file: not read.
                        {
                            "path": "web/package.json",
                            "type": "blob",
                            "sha": "s9",
                            "size": 5_000_000,
                        },
                    ],
                },
            )
        if url.path == "/repos/octo/api/git/blobs/s1":
            content = base64.b64encode(b'{"dependencies": {"pg": "8"}}').decode()
            return httpx.Response(200, json={"content": content, "encoding": "base64"})
        raise AssertionError(url)

    github = app(httpx.MockTransport(handle))
    repos = github.repositories("ghs_abc")
    assert [(r.repo_id, r.full_name, r.archived) for r in repos] == [
        (1, "octo/api", False),
        (2, "octo/web", True),
    ]
    assert repos[0].pushed_at == datetime(2026, 10, 1, tzinfo=UTC)
    assert github.languages("ghs_abc", "octo/api") == ["TypeScript", "Go"]
    assert github.tree("ghs_abc", "octo/api", "main") == (
        [("package.json", "s1")],
        False,
    )
    assert json.loads(github.blob("ghs_abc", "octo/api", "s1")) == {
        "dependencies": {"pg": "8"}
    }


def test_gone_rate_limited_and_empty() -> None:
    def respond(status: int, headers: dict[str, str] | None = None) -> HttpGitHubApp:
        return app(
            httpx.MockTransport(
                lambda _: httpx.Response(status, json={}, headers=headers or {})
            )
        )

    with pytest.raises(GitHubGone):
        respond(404).installation_token(11)
    with pytest.raises(GitHubError):
        respond(403, {"x-ratelimit-remaining": "0"}).repositories("t")
    with pytest.raises(GitHubError):  # a secondary rate limit
        respond(403, {"retry-after": "60"}).repositories("t")
    # Suspended, blocked or under a legal hold: left out, not retried for ever.
    with pytest.raises(GitHubGone):
        respond(403).installation_token(11)
    with pytest.raises(GitHubGone):
        respond(451).languages("t", "o/r")
    with pytest.raises(GitHubError):
        respond(502).languages("t", "o/r")
    # An empty repository has no tree.
    assert respond(409).tree("t", "o/r", "main") == ([], False)
