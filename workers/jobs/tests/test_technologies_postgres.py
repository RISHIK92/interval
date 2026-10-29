"""PostgresTechnologies (P2-W12-S03) on the real schema: the seed sync, the resolution
of dependencies to technologies and concepts, unclaimed packages and suggestions."""

from datetime import UTC, datetime

import psycopg

from interval_jobs.adapters.postgres import (
    PostgresRankingInputs,
    PostgresStore,
    PostgresTechnologies,
)
from interval_jobs.ports import FeedEntry, TagResult, Tags, TechnologySuggestion
from interval_jobs.technologies import Package, TechnologySeed

from .test_db_guards import a_user

PG = TechnologySeed(
    "t-postgres",
    "PostgreSQL",
    (Package("npm", "pg", False), Package("go", "github.com/jackc/pgx", True)),
    ("t-mvcc", "t-indexes"),
)
NEST = TechnologySeed(
    "t-nestjs", "NestJS", (Package("npm", "@nestjs/", True),), ("t-indexes",)
)
SWAGGER = TechnologySeed(
    "t-swagger", "Swagger", (Package("npm", "@nestjs/swagger", False),), ("t-mvcc",)
)


def concepts(conn: psycopg.Connection) -> None:
    conn.execute(
        "insert into concept (slug, name, topic) values "
        "('t-mvcc', 'MVCC', 'databases'), ('t-indexes', 'Indexes', 'databases')"
    )


def repo_with(
    conn: psycopg.Connection, user_id: str, deps: list[tuple[str, str]]
) -> None:
    a_user(conn, user_id)
    conn.execute(
        "insert into github_account (user_id, github_user_id, login) "
        "values (%s, hashtext(%s)::bigint + 9000000000, %s)",
        (user_id, user_id, user_id),
    )
    conn.execute(
        "insert into github_repository (user_id, repo_id, installation_id, full_name, "
        "default_branch) values (%s, 1, 1, %s, 'main')",
        (user_id, f"{user_id}/api"),
    )
    for ecosystem, name in deps:
        conn.execute(
            "insert into github_dependency (user_id, repo_id, ecosystem, name, path) "
            "values (%s, 1, %s, %s, 'package.json')",
            (user_id, ecosystem, name),
        )


def resolved(conn: psycopg.Connection, user_id: str) -> dict[str, str]:
    return {
        str(name): str(slug)
        for name, slug in conn.execute(
            "select dt.name, t.slug from github_dependency_technology dt "
            "join technology t on t.id = dt.technology_id where dt.user_id = %s",
            (user_id,),
        ).fetchall()
    }


def test_the_seed_syncs_and_dependencies_resolve_exactly_or_by_longest_prefix(
    conn: psycopg.Connection,
) -> None:
    concepts(conn)
    techs = PostgresTechnologies(conn)
    synced = techs.sync_seed([PG, NEST, SWAGGER])
    assert (synced.added, synced.updated) == (3, 0)
    repo_with(
        conn,
        "tc1",
        [
            ("npm", "pg"),
            ("go", "github.com/jackc/pgx/v5"),
            ("npm", "@nestjs/core"),
            ("npm", "@nestjs/swagger"),  # exact beats the scope prefix
            ("npm", "left-pad"),
        ],
    )
    assert resolved(conn, "tc1") == {
        "pg": "t-postgres",
        "github.com/jackc/pgx/v5": "t-postgres",
        "@nestjs/core": "t-nestjs",
        "@nestjs/swagger": "t-swagger",
    }
    rows = conn.execute(
        "select technology, c.slug, repositories "
        "from user_technology_concepts('tc1') u "
        "join concept c on c.id = u.concept_id where technology = 'PostgreSQL' "
        "order by c.slug"
    ).fetchall()
    assert rows == [
        ("PostgreSQL", "t-indexes", ["tc1/api"]),
        ("PostgreSQL", "t-mvcc", ["tc1/api"]),
    ]


def test_a_reload_updates_retires_what_left_and_leaves_suggestions_alone(
    conn: psycopg.Connection,
) -> None:
    concepts(conn)
    techs = PostgresTechnologies(conn)
    techs.sync_seed([PG, NEST])
    conn.execute(
        "insert into technology (slug, name, source) "
        "values ('t-accepted', 'A', 'suggestion')"
    )
    synced = techs.sync_seed([PG])
    assert (synced.added, synced.updated, synced.retired) == (0, 1, 1)
    states = dict(
        conn.execute(
            "select slug, retired_at is not null from technology "
            "where slug in ('t-postgres', 't-nestjs', 't-accepted')"
        ).fetchall()
    )
    assert states == {"t-postgres": False, "t-nestjs": True, "t-accepted": False}
    repo_with(conn, "tc2", [("npm", "@nestjs/core")])
    assert resolved(conn, "tc2") == {}  # a retired technology claims nothing


def test_unclaimed_packages_rank_by_users_and_a_suggestion_is_never_asked_twice(
    conn: psycopg.Connection,
) -> None:
    concepts(conn)
    techs = PostgresTechnologies(conn)
    techs.sync_seed([PG])
    repo_with(conn, "tc3", [("npm", "pg"), ("npm", "zz-rare"), ("npm", "zz-common")])
    repo_with(conn, "tc4", [("npm", "zz-common")])
    mine = [u for u in techs.unclaimed(1, 1000) if u.package.startswith("zz-")]
    assert [(u.package, u.users) for u in mine] == [("zz-common", 2), ("zz-rare", 1)]
    techs.save_suggestion(
        TechnologySuggestion("npm", "zz-common", 2, "m", "ZZ", "zz", ("t-mvcc",))
    )
    techs.save_suggestion(
        TechnologySuggestion("npm", "zz-rare", 1, "m", None, None, ())
    )
    left = [u.package for u in techs.unclaimed(1, 1000) if u.package.startswith("zz-")]
    assert left == []
    assert conn.execute(
        "select package, status from technology_suggestion "
        "where package like 'zz-%%' order by package"
    ).fetchall() == [("zz-common", "pending"), ("zz-rare", "skipped")]


def test_an_accepted_package_on_a_seed_technology_survives_a_reload(
    conn: psycopg.Connection,
) -> None:
    concepts(conn)
    techs = PostgresTechnologies(conn)
    techs.sync_seed([PG])
    # Accepted onto the seed's technology (what the admin page does).
    conn.execute(
        "insert into technology_package (ecosystem, pattern, prefix, technology_id, "
        "origin) select 'npm', 'zz-pg-extra', false, id, 'suggestion' "
        "from technology where slug = 't-postgres'"
    )
    techs.sync_seed([PG])
    repo_with(conn, "tc5", [("npm", "zz-pg-extra")])
    assert resolved(conn, "tc5") == {"zz-pg-extra": "t-postgres"}


def test_a_single_users_possibly_private_names_are_not_sent(
    conn: psycopg.Connection,
) -> None:
    concepts(conn)
    techs = PostgresTechnologies(conn)
    repo_with(
        conn,
        "tc6",
        [
            ("npm", "@zzacme/billing"),
            ("go", "git.zzacme.internal/payments"),
            ("go", "github.com/zz/public"),
            ("npm", "zz-plain"),
        ],
    )
    asked = {u.package for u in techs.unclaimed(1, 1000)}
    assert {"github.com/zz/public", "zz-plain"} <= asked
    assert not {"@zzacme/billing", "git.zzacme.internal/payments"} & asked
    # Shared by two users: no longer one person's secret.
    repo_with(conn, "tc7", [("npm", "@zzacme/billing")])
    assert "@zzacme/billing" in {u.package for u in techs.unclaimed(1, 1000)}


# P2-W12-S04: the concepts a user's projects map to, with the technologies behind them.
def test_project_concepts_name_each_concepts_technologies(
    conn: psycopg.Connection,
) -> None:
    concepts(conn)
    PostgresTechnologies(conn).sync_seed([PG, NEST])
    repo_with(conn, "tc8", [("npm", "pg"), ("npm", "@nestjs/core")])
    found = PostgresRankingInputs(conn).project_concepts("tc8")
    assert found["t-mvcc"] == (("t-postgres", "PostgreSQL"),)
    assert found["t-indexes"] == (("t-nestjs", "NestJS"), ("t-postgres", "PostgreSQL"))
    assert PostgresRankingInputs(conn).project_concepts("nobody") == {}


# P2-W12-S05: what a project note may send, which items still need one, and a line
# replaced when the repositories matching its item change.
def test_project_notes_follow_the_repositories_matching_the_item(
    conn: psycopg.Connection,
) -> None:
    concepts(conn)
    PostgresTechnologies(conn).sync_seed([PG, NEST])
    repo_with(conn, "tc9", [("npm", "pg")])
    conn.execute(
        "update github_repository set description = 'Orders API' where user_id = 'tc9'"
    )
    store = PostgresStore(conn)
    source = store.sources.upsert(
        name="pn-source",
        feed_url="https://pn.example.test/feed.xml",
        rights_profile="full_text_internal",
        homepage=None,
    )

    def item(guid: str, concept: str) -> int:
        found = store.items.upsert_from_feed(
            source,
            FeedEntry(
                guid=f"pn-{guid}",
                link=f"https://pn.example.test/{guid}",
                title=f"About {concept}",
                author=None,
                published_at=datetime(2026, 10, 1, tzinfo=UTC),
                updated_at=None,
                summary=None,
            ),
            keep_excerpt=False,
        )
        store.tags.save(
            found, TagResult(Tags("beginner", frozenset({concept})), {}), "m", 1
        )
        return found

    on_mvcc, elsewhere = item("a", "t-mvcc"), item("b", "nothing")
    github = store.github
    note = github.project_note_input("tc9", on_mvcc)
    assert note is not None
    assert (note.title, note.source_name) == ("About t-mvcc", "pn-source")
    assert note.technologies == ("PostgreSQL",)
    assert note.repositories == (("tc9/api", "Orders API"),)
    assert github.project_note_input("tc9", elsewhere) is None
    assert github.project_notes_missing("tc9", [elsewhere, on_mvcc], 10) == [on_mvcc]
    github.save_project_note("tc9", on_mvcc, note, "Orders API keeps MVCC.", "m")
    assert github.project_notes_missing("tc9", [on_mvcc], 10) == []
    # A line from an older prompt version is asked again (and replaced on save).
    conn.execute("update project_note set prompt_version = 1 where user_id = 'tc9'")
    assert github.project_notes_missing("tc9", [on_mvcc], 10) == [on_mvcc]
    github.save_project_note("tc9", on_mvcc, note, "Orders API keeps MVCC.", "m")
    assert conn.execute(
        "select prompt_version from project_note where user_id = 'tc9'"
    ).fetchall() == [(2,)]
    # A second repository on the same concept: a new set, a new line, the old one gone.
    conn.execute(
        "insert into github_repository (user_id, repo_id, installation_id, full_name, "
        "default_branch) values ('tc9', 2, 1, 'tc9/web', 'main')"
    )
    conn.execute(
        "insert into github_dependency (user_id, repo_id, ecosystem, name, path) "
        "values ('tc9', 2, 'npm', 'pg', 'package.json')"
    )
    assert github.project_notes_missing("tc9", [on_mvcc], 10) == [on_mvcc]
    wider = github.project_note_input("tc9", on_mvcc)
    assert wider is not None
    github.save_project_note("tc9", on_mvcc, wider, "Both use MVCC.", "m")
    rows = conn.execute(
        "select repositories, text from project_note where user_id = 'tc9'"
    ).fetchall()
    assert rows == [(["tc9/api", "tc9/web"], "Both use MVCC.")]
    # A repository no longer shared takes its lines with it at the next sync.
    github.save_sync("tc9", [])
    assert conn.execute(
        "select count(*) from project_note where user_id = 'tc9'"
    ).fetchone() == (0,)
    github.save_project_note("tc9", on_mvcc, note, "Orders API keeps MVCC.", "m")
    # Disconnecting takes the lines with it.
    conn.execute("delete from github_account where user_id = 'tc9'")
    assert conn.execute(
        "select count(*) from project_note where user_id = 'tc9'"
    ).fetchone() == (0,)


# Q-P2-46: the cards a batch may write project notes for: connected users' visible feed
# entries whose explanation is a project one, once per item, best-ranked first.
def test_project_note_candidates_come_from_connected_users_project_cards(
    conn: psycopg.Connection,
) -> None:
    repo_with(conn, "tc10", [("npm", "pg")])
    a_user(conn, "tc11")  # not connected
    store = PostgresStore(conn)
    source = store.sources.upsert(
        name="cand-source",
        feed_url="https://cand.example.test/feed.xml",
        rights_profile="full_text_internal",
        homepage=None,
    )
    items = [
        store.items.upsert_from_feed(
            source,
            FeedEntry(
                guid=f"cand-{n}",
                link=f"https://cand.example.test/{n}",
                title=f"Post {n}",
                author=None,
                published_at=datetime(2026, 10, 1, tzinfo=UTC),
                updated_at=None,
                summary=None,
            ),
            keep_excerpt=False,
        )
        for n in range(3)
    ]
    rows = [
        ("tc10", "3-8", items[1], 1, ["project_match"]),
        ("tc10", "8-15", items[1], 4, ["project_match"]),  # the same item again
        ("tc10", "3-8", items[0], 2, ["project_match"]),
        ("tc10", "3-8", items[2], 3, ["goal_match"]),  # not a project card
        ("tc11", "3-8", items[0], 1, ["project_match"]),  # not connected
    ]
    for user, chip, item, rank, kinds in rows:
        conn.execute(
            "insert into user_feed_entry (user_id, chip, content_item_id, rank, "
            "top_signal, reason_kinds) values (%s, %s, %s, %s, 'project_match', %s)",
            (user, chip, item, rank, kinds),
        )
    found = store.github.project_note_candidates()
    assert found.get("tc10") == [items[1], items[0]]
    assert "tc11" not in found


# user_goal_concepts (the Paths page's "Fits your goal"): the stack goal points at the
# concepts the user's projects map to; without it, they don't count.
def test_user_goal_concepts_include_projects_only_with_the_stack_goal(
    conn: psycopg.Connection,
) -> None:
    concepts(conn)
    PostgresTechnologies(conn).sync_seed([PG])
    repo_with(conn, "tc12", [("npm", "pg")])

    def goal_concepts() -> set[str]:
        return {
            str(r[0])
            for r in conn.execute(
                "select c.slug from user_goal_concepts('tc12') g "
                "join concept c on c.id = g.concept_id"
            ).fetchall()
        }

    conn.execute(
        "insert into user_preferences (user_id, goals, topics, level, break_length) "
        "values ('tc12', '{stay-sharp}', '{backend}', 'beginner', '3-8')"
    )
    assert goal_concepts() == set()
    conn.execute(
        "update user_preferences set goals = '{stack-i-use}' where user_id = 'tc12'"
    )
    assert goal_concepts() == {"t-mvcc", "t-indexes"}
