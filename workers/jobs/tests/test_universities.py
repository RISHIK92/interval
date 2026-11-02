"""The university list (P3-W14-S03, ADR-0032): the seed parses, and loading it twice
adds nothing the second time, in memory and on the real schema."""

from pathlib import Path

import psycopg
import pytest

from interval_jobs.adapters.memory import InMemoryUniversities
from interval_jobs.adapters.postgres import PostgresUniversities
from interval_jobs.ports import UniversitiesSynced
from interval_jobs.universities import (
    UniversitySeed,
    UniversitySeedError,
    parse_universities,
)

SEED = Path(__file__).parents[1] / "seeds" / "universities.json"


def test_the_shipped_seed_parses() -> None:
    listed = parse_universities(SEED.read_text(encoding="utf-8"), str(SEED))
    assert len(listed) > 10_000
    assert UniversitySeed("Indian Institute of Technology, Delhi", "IN") in listed


@pytest.mark.parametrize(
    ("text", "problem"),
    [
        ("[", "not JSON"),
        ("[]", "needs a `universities` list"),
        ('{"universities": [1]}', "must be a mapping"),
        ('{"universities": [{"name": "X", "country": "IN"}]}', "bad name"),
        ('{"universities": [{"name": "A  B", "country": "IN"}]}', "untidy"),
        ('{"universities": [{"name": "AB", "country": "in"}]}', "bad country"),
        ('{"universities": [{"name": "A\\u0093B", "country": "IN"}]}', "hidden"),
        ('{"universities": [{"name": "A\\u200bB", "country": "IN"}]}', "hidden"),
        (
            '{"universities": [{"name": "AB", "country": "IN"},'
            ' {"name": "AB", "country": "IN"}]}',
            "appears twice",
        ),
    ],
)
def test_a_bad_seed_says_what_is_wrong(text: str, problem: str) -> None:
    with pytest.raises(UniversitySeedError, match=problem):
        parse_universities(text, "u.json")


def test_the_same_name_in_two_countries_is_two_universities() -> None:
    listed = parse_universities(
        '{"universities": [{"name": "AB", "country": "IN"},'
        ' {"name": "AB", "country": "US"}]}',
        "u.json",
    )
    assert listed == [UniversitySeed("AB", "IN"), UniversitySeed("AB", "US")]


LIST = [UniversitySeed("Zq University", "IN"), UniversitySeed("Zq College", "GB")]


def test_memory_loads_once() -> None:
    universities = InMemoryUniversities()
    assert universities.sync_list(LIST) == UniversitiesSynced(added=2, kept=0)
    assert universities.sync_list(
        [*LIST, UniversitySeed("Zq Institute", "US")]
    ) == UniversitiesSynced(added=1, kept=2)


def test_postgres_loads_once_and_keeps_what_left_the_seed(
    conn: psycopg.Connection,
) -> None:
    universities = PostgresUniversities(conn)
    assert universities.sync_list(LIST) == UniversitiesSynced(added=2, kept=0)
    assert universities.sync_list(LIST[:1]) == UniversitiesSynced(added=0, kept=1)
    rows = conn.execute(
        "select name, country, listed from university where name like 'Zq %%' "
        "order by name"
    ).fetchall()
    assert rows == [("Zq College", "GB", True), ("Zq University", "IN", True)]
