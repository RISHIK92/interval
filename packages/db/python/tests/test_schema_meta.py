import os

import psycopg
from psycopg.rows import dict_row

from interval_db.generated import SchemaMeta


def test_initial_migration_creates_and_seeds_schema_meta() -> None:
    url = os.environ.get("DATABASE_URL")
    assert url, (
        "DATABASE_URL is not set; copy .env.example to .env and run "
        "`docker compose up -d`"
    )

    with psycopg.connect(url) as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select key, value from schema_meta where key = %s",
            ("initial_migration",),
        )
        row = cur.fetchone()

    expected: SchemaMeta = {"key": "initial_migration", "value": "20261025000000"}
    assert row == expected
