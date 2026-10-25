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
    # Each test runs in a transaction that is rolled back, leaving the dev DB unchanged.
    with psycopg.connect(url) as connection:
        yield connection
        connection.rollback()
