"""PostgresTechnologies (P2-W12-S03) on the real schema: the seed sync, the resolution
of dependencies to technologies and concepts, unclaimed packages and suggestions."""

import psycopg

from interval_jobs.adapters.postgres import PostgresTechnologies
from interval_jobs.ports import TechnologySuggestion
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
