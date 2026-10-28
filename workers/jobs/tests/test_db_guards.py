import psycopg
import pytest

from interval_db.generated import RightsProfile
from interval_jobs.adapters.postgres import PostgresStore


def item_for(conn: psycopg.Connection, profile: RightsProfile) -> int:
    source_id = PostgresStore(conn).sources.upsert(
        name=f"guard-{profile}",
        feed_url=f"https://guard.example.test/{profile}",
        rights_profile=profile,
        homepage=None,
    )
    row = conn.execute(
        "insert into content_item (source_id, guid, canonical_url, title) "
        "values (%s, 'g', 'https://guard.example.test/a', 't') returning id",
        (source_id,),
    ).fetchone()
    assert row is not None
    return row[0]


@pytest.mark.parametrize("profile", ["metadata_only", "excerpt"])
def test_database_refuses_full_text_the_profile_does_not_allow(
    conn: psycopg.Connection, profile: RightsProfile
) -> None:
    item_id = item_for(conn, profile)
    with pytest.raises(
        psycopg.errors.RaiseException, match="does not allow storing full text"
    ):
        conn.execute(
            "insert into content_item_private_text (content_item_id, text) "
            "values (%s, 'x')",
            (item_id,),
        )


def test_database_refuses_an_excerpt_for_metadata_only(
    conn: psycopg.Connection,
) -> None:
    item_id = item_for(conn, "metadata_only")
    with pytest.raises(
        psycopg.errors.RaiseException, match="does not allow storing an excerpt"
    ):
        conn.execute("update content_item set excerpt = 'x' where id = %s", (item_id,))


FULL_TEXT = "guard-full_text_internal"


def enable_moments(conn: psycopg.Connection, enabled: bool) -> None:
    conn.execute(
        "update source set moments_seeded = %s, moments_enabled = %s where name = %s",
        (enabled, enabled, FULL_TEXT),
    )


def add_moment(conn: psycopg.Connection, item_id: int) -> None:
    conn.execute(
        "insert into moment (content_item_id, ordinal, title, estimated_minutes, link, "
        "link_type) values (%s, 0, 't', 1, 'https://guard.example.test/a', 'page_top')",
        (item_id,),
    )


def moment_count(conn: psycopg.Connection, item_id: int) -> int:
    row = conn.execute(
        "select count(*) from moment where content_item_id = %s", (item_id,)
    ).fetchone()
    assert row is not None
    return row[0]


@pytest.mark.parametrize(
    ("profile", "moments_enabled"),
    [("full_text_internal", False), ("excerpt", True), ("metadata_only", True)],
)
def test_database_refuses_moments_without_the_switch_and_full_text_rights(
    conn: psycopg.Connection, profile: RightsProfile, moments_enabled: bool
) -> None:
    item_id = item_for(conn, profile)
    conn.execute(
        "update source set moments_seeded = %s, moments_enabled = %s where name = %s",
        (moments_enabled, moments_enabled, f"guard-{profile}"),
    )
    with pytest.raises(psycopg.errors.RaiseException, match="does not allow moments"):
        add_moment(conn, item_id)


def test_switching_moments_off_deletes_them(conn: psycopg.Connection) -> None:
    item_id = item_for(conn, "full_text_internal")
    enable_moments(conn, True)
    add_moment(conn, item_id)
    enable_moments(conn, False)
    assert moment_count(conn, item_id) == 0


def test_lowering_the_profile_deletes_sections_and_moments(
    conn: psycopg.Connection,
) -> None:
    item_id = item_for(conn, "full_text_internal")
    enable_moments(conn, True)
    add_moment(conn, item_id)
    conn.execute(
        "insert into content_item_section (content_item_id, ordinal, heading, level, "
        "anchor_id, word_count) values (%s, 0, 'h', 2, null, 10)",
        (item_id,),
    )
    conn.execute(
        "update source set rights_profile = 'excerpt' where name = %s", (FULL_TEXT,)
    )
    assert moment_count(conn, item_id) == 0
    row = conn.execute(
        "select count(*) from content_item_section where content_item_id = %s",
        (item_id,),
    ).fetchone()
    assert row == (0,)


@pytest.mark.parametrize("profile", ["metadata_only", "excerpt"])
def test_database_refuses_sections_the_profile_does_not_allow(
    conn: psycopg.Connection, profile: RightsProfile
) -> None:
    item_id = item_for(conn, profile)
    with pytest.raises(
        psycopg.errors.RaiseException, match="does not allow storing full text"
    ):
        conn.execute(
            "insert into content_item_section "
            "(content_item_id, ordinal, heading, level, anchor_id, word_count) "
            "values (%s, 0, 'h', 2, null, 10)",
            (item_id,),
        )


def test_lowering_the_profile_purges_private_text_and_excerpt_before_any_reingest(
    conn: psycopg.Connection,
) -> None:
    store = PostgresStore(conn)
    full = item_for(conn, "full_text_internal")
    conn.execute(
        "insert into content_item_private_text (content_item_id, text) "
        "values (%s, 'x')",
        (full,),
    )
    store.sources.upsert(
        name="guard-full_text_internal",
        feed_url="https://guard.example.test/full_text_internal",
        rights_profile="metadata_only",
        homepage=None,
    )
    row = conn.execute(
        "select count(*) from content_item_private_text where content_item_id = %s",
        (full,),
    ).fetchone()
    assert row == (0,)

    excerpt = item_for(conn, "excerpt")
    conn.execute("update content_item set excerpt = 'e' where id = %s", (excerpt,))
    store.sources.upsert(
        name="guard-excerpt",
        feed_url="https://guard.example.test/excerpt",
        rights_profile="metadata_only",
        homepage=None,
    )
    row = conn.execute(
        "select excerpt from content_item where id = %s", (excerpt,)
    ).fetchone()
    assert row == (None,)


def test_a_user_needs_a_beta_group_and_an_invite_code(conn: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.NotNullViolation):
        conn.execute(
            "insert into app_user (id, name, email) "
            "values ('u1', 'n', 'u1@example.test')"
        )


def test_an_invite_code_cannot_be_used_more_than_its_limit(
    conn: psycopg.Connection,
) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into invite_code "
            "(code, beta_group, max_uses, used_count, expires_at) "
            "values ('LIMITCODE12', 'student', 1, 2, now() + interval '1 day')"
        )


def test_a_users_group_must_match_their_invite_codes_group(
    conn: psycopg.Connection,
) -> None:
    row = conn.execute(
        "insert into invite_code (code, beta_group, max_uses, expires_at) "
        "values ('GROUPCODE12', 'student', 1, now() + interval '1 day') returning id"
    ).fetchone()
    assert row is not None
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        conn.execute(
            "insert into app_user (id, name, email, beta_group, invite_code_id) "
            "values ('u2', 'n', 'u2@example.test', 'developer', %s)",
            (row[0],),
        )


def a_user(conn: psycopg.Connection, user_id: str) -> None:
    row = conn.execute(
        "insert into invite_code (code, beta_group, max_uses, expires_at) "
        "values (%s, 'student', 1, now() + interval '1 day') returning id",
        (f"PLANCODE{user_id.upper()}",),
    ).fetchone()
    assert row is not None
    conn.execute(
        "insert into app_user (id, name, email, beta_group, invite_code_id) "
        "values (%s, 'n', %s, 'student', %s)",
        (user_id, f"{user_id}@example.test", row[0]),
    )


def entitlements(
    conn: psycopg.Connection, user_id: str
) -> list[tuple[str, int | None]]:
    rows = conn.execute(
        "select capability::text, limit_value from user_entitlement "
        "where user_id = %s order by capability",
        (user_id,),
    ).fetchall()
    return [(r[0], r[1]) for r in rows]


# OPS-3, Q-P1-22: every user has a plan; the beta plan is the default.
def test_a_new_user_is_on_the_beta_plan(conn: psycopg.Connection) -> None:
    a_user(conn, "plan1")
    row = conn.execute("select plan_id from app_user where id = 'plan1'").fetchone()
    assert row == ("beta",)
    assert entitlements(conn, "plan1") == [
        ("ai.budget.daily_cents", 50),
        ("ai.notes.daily", 20),
        ("books.count", 5),
        ("books.max_mb", 50),
        ("books.max_pages", 1000),
        ("feed.read", None),
    ]


def test_a_plan_limit_cannot_be_negative(conn: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "update plan_capability set limit_value = -1 "
            "where plan_id = 'beta' and capability = 'ai.notes.daily'"
        )


# Q-P1-29: admin is granted per user on top of the plan; a grant never duplicates or
# overrides a capability the plan already gives.
def test_per_user_grants_add_to_the_plan_without_duplicating_it(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "plan2")
    conn.execute(
        "insert into user_capability (user_id, capability) values "
        "('plan2', 'admin.review'), ('plan2', 'feed.read')"
    )
    assert entitlements(conn, "plan2") == [
        ("admin.review", None),
        ("ai.budget.daily_cents", 50),
        ("ai.notes.daily", 20),
        ("books.count", 5),
        ("books.max_mb", 50),
        ("books.max_pages", 1000),
        ("feed.read", None),
    ]


# A grant carries no limit, so a capability some plan limits (an OPS-4 cost) can only
# come from a plan; otherwise one grant would mean unlimited use.
def test_a_limited_capability_cannot_be_granted_per_user(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "plan3")
    with pytest.raises(psycopg.errors.RaiseException, match="grant it through a plan"):
        conn.execute(
            "insert into user_capability (user_id, capability) "
            "values ('plan3', 'ai.notes.daily')"
        )


# OPS-4, Q-P1-23: placeholder budgets until the owner sets real ones before the beta.
def test_placeholder_budgets_are_50_cents_per_user_and_5_dollars_global(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "budget1")
    row = conn.execute(
        "select limit_value from user_entitlement "
        "where user_id = 'budget1' and capability = 'ai.budget.daily_cents'"
    ).fetchone()
    assert row == (50,)
    assert conn.execute("select daily_cents from ai_budget").fetchall() == [(500,)]


@pytest.mark.parametrize(
    ("column", "value"),
    [("cost_usd", -0.01), ("input_tokens", -1), ("output_tokens", -1)],
)
def test_a_usage_row_cannot_be_negative(
    conn: psycopg.Connection, column: str, value: float
) -> None:
    values = {"cost_usd": 0, "input_tokens": 0, "output_tokens": 0, column: value}
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into ai_usage (is_offline, feature, provider, model, "
            "input_tokens, output_tokens, cost_usd) "
            "values (true, 'tagging', 'openrouter', 'm', %s, %s, %s)",
            (values["input_tokens"], values["output_tokens"], values["cost_usd"]),
        )


def test_the_budget_cannot_be_raised_for_one_user(conn: psycopg.Connection) -> None:
    a_user(conn, "budget2")
    with pytest.raises(psycopg.errors.RaiseException, match="grant it through a plan"):
        conn.execute(
            "insert into user_capability (user_id, capability) "
            "values ('budget2', 'ai.budget.daily_cents')"
        )


# P1-W4-S03: numeric holds NaN and Infinity, and a negative weight reverses its rule;
# the owner tunes this table by hand, so bad values are refused when written.
@pytest.mark.parametrize("value", ["NaN", "Infinity", "-1"])
def test_ranking_config_refuses_values_that_break_ranking(
    conn: psycopg.Connection, value: str
) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "update ranking_config set value = %s::numeric "
            "where key = 'weight.quality'",
            (value,),
        )
