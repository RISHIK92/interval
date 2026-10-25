import os
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


@pytest.fixture
def conn() -> Iterator[psycopg.Connection]:
    url = os.environ.get("DATABASE_URL")
    assert url, "DATABASE_URL is not set; copy .env.example to .env"
    # Each test runs inside an explicit outer transaction that is always rolled back, so
    # nested `transaction()` blocks in adapters become savepoints and never commit.
    with (
        psycopg.connect(url) as connection,
        connection.transaction(force_rollback=True),
    ):
        yield connection
