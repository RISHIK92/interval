"""Composition root (ADR-0012): the only place that builds adapters.

Every process (the CLI now, the queue consumer later) gets its ports from here, so
swapping a service means changing this file and one adapter.
"""

import os
import sys
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass

import httpx
from psycopg.conninfo import conninfo_to_dict

from interval_jobs.adapters.http_fetcher import HttpxFetcher
from interval_jobs.adapters.postgres import PostgresStore, unit_of_work
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
USER_AGENT = "Interval/0.0 (personal learning platform; feed reader)"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set; copy .env.example to .env")
    # CLAUDE.md: never touch a non-local database. Parse as libpq does, so `?host=` or
    # `?hostaddr=` in the query cannot override the host in the URL. On the VM the
    # database is the compose service `postgres`; write-env.sh lists it explicitly. Only
    # compose-style service names count: entries with a dot or colon (a domain or an IP
    # address) are ignored, so the allowlist can never open a remote host.
    entries = (e.strip() for e in os.environ.get("ALLOWED_DB_HOSTS", "").split(","))
    allowed = LOCAL_HOSTS | {e for e in entries if e and "." not in e and ":" not in e}
    params = conninfo_to_dict(url)
    hosts = {
        str(params.get("host") or "localhost"),
        str(params.get("hostaddr") or "127.0.0.1"),
    }
    if not hosts <= allowed and os.environ.get("CI") != "true":
        sys.exit(
            f"Refusing to touch database host {sorted(hosts)}: "
            "only localhost (or ALLOWED_DB_HOSTS) outside CI."
        )
    return url


@dataclass(frozen=True)
class Services:
    store: PostgresStore
    fetcher: HttpxFetcher
    extractor: TrafilaturaExtractor


@contextmanager
def services() -> Generator[Services]:
    """One unit of work plus the web and parsing adapters; commits on success."""
    with (
        unit_of_work(database_url()) as store,
        httpx.Client(headers={"user-agent": USER_AGENT}) as http,
    ):
        yield Services(store, HttpxFetcher(http), TrafilaturaExtractor())
