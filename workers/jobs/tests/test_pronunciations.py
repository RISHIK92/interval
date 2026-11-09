"""The pronunciation dictionary (TTS-2, Q-P4-10, P4-W22-S02): the repo's seed, a script
said with it before TTS, and reloads that leave the admin's own terms alone."""

from pathlib import Path

import psycopg
import pytest

from interval_jobs.adapters.memory import InMemoryPronunciations
from interval_jobs.adapters.postgres import PostgresPronunciations
from interval_jobs.ports import Pronunciation
from interval_jobs.pronunciations import PronunciationSeedError, parse_seed, spoken

SEED = Path(__file__).parents[1] / "seeds" / "pronunciations.yaml"
DICT = [
    Pronunciation("SQL", "S Q L"),
    Pronunciation("PostgreSQL", "post gress Q L"),
    Pronunciation("nginx", "engine x"),
    Pronunciation("HTTP/2", "H T T P two"),
]


def test_the_repos_seed_parses() -> None:
    entries = parse_seed(SEED.read_text(encoding="utf-8"), str(SEED))
    assert Pronunciation("kubectl", "cube control") in entries
    assert len({e.term.lower() for e in entries}) == len(entries)


@pytest.mark.parametrize(
    ("text", "says"),
    [
        ("nginx: engine x\nNGINX: again\n", "listed twice"),
        # YAML would keep only the last of two equal keys.
        ("nginx: engine x\nnginx: again\n", "listed twice"),
        ("nginx: ''\n", "1-200"),
        ("- nginx\n", "term: how to say it"),
        ("nginx: [engine, x]\n", "both must be text"),
        ("nginx: :\n  bad", "not YAML"),
    ],
)
def test_a_broken_seed_loads_nothing(text: str, says: str) -> None:
    with pytest.raises(PronunciationSeedError, match=says):
        parse_seed(text)


@pytest.mark.parametrize(
    ("script", "said"),
    [
        # Longest first: PostgreSQL is never "Postgre" then "SQL".
        ("PostgreSQL and SQL differ.", "post gress Q L and S Q L differ."),
        # Any case, punctuation kept.
        ("Behind NGINX, then nginx.", "Behind engine x, then engine x."),
        ("Over HTTP/2 today", "Over H T T P two today"),
        # Never inside a longer word; joined ones are said too.
        ("MySQL, sqlx, SQL_MODE", "MySQL, sqlx, SQL_MODE"),
        ("SQL-based, nginx/SQL", "S Q L-based, engine x/S Q L"),
        # Case folding that changes a string's length is no crash.
        ("NGİNX here", "engine x here"),
    ],
)
def test_a_script_is_said_with_the_dictionary(script: str, said: str) -> None:
    assert spoken(script, DICT) == said


def test_an_empty_dictionary_changes_nothing() -> None:
    assert spoken("nginx", []) == "nginx"


def test_a_reload_changes_only_what_the_seed_changed_never_the_admins() -> None:
    store = InMemoryPronunciations()
    assert store.load(DICT) == 4
    assert store.load(DICT) == 0
    store.rows["sql"] = (Pronunciation("SQL", "sequel"), "admin")
    # The seed now lists only SQL: the others go; the admin's SQL stays.
    assert store.load([Pronunciation("SQL", "S Q L")]) == 3
    assert store.all() == [Pronunciation("SQL", "sequel")]


def test_postgres_loads_once_and_keeps_the_admins_terms(
    conn: psycopg.Connection,
) -> None:
    conn.execute(
        "insert into pronunciation (term, say, origin) "
        "values ('ZZ-Admin', 'zee zee', 'admin')"
    )
    store = PostgresPronunciations(conn)
    seeds = [Pronunciation("zz-seed", "zee seed"), Pronunciation("zz-admin", "x")]
    conn.execute("delete from pronunciation where origin = 'seed'")
    assert store.load(seeds) == 1
    assert store.load(seeds) == 0
    assert store.load([Pronunciation("zz-seed", "zee seed again")]) == 1
    # A term dropped from the file goes; the admin's stays.
    assert store.load([]) == 1
    ours = [p for p in store.all() if p.term.lower().startswith("zz-")]
    assert ours == [Pronunciation("ZZ-Admin", "zee zee")]
