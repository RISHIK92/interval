"""P4-W19-S04b: phones' push tokens as the worker reads them; only on a plan with
push.notify (ADR-0036)."""

import psycopg

from interval_jobs.adapters.postgres import PostgresDeviceTokens
from interval_jobs.ports import NativeTarget

from .test_db_guards import a_user


def test_a_users_phones_on_a_plan_with_push_and_a_dropped_one(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "dt1")
    conn.execute(
        "insert into device_push_token (user_id, platform, token)"
        " values ('dt1', 'ios', 'aa11'), ('dt1', 'android', 'fcm:bb')"
    )
    tokens = PostgresDeviceTokens(conn)
    assert tokens.for_user("dt1") == [
        NativeTarget("ios", "aa11"),
        NativeTarget("android", "fcm:bb"),
    ]
    tokens.drop("aa11")
    assert tokens.for_user("dt1") == [NativeTarget("android", "fcm:bb")]
    conn.execute(
        "delete from plan_capability"
        " where plan_id = 'beta' and capability = 'push.notify'"
    )
    assert tokens.for_user("dt1") == []
    email = conn.execute("select email from app_user where id = 'dt1'").fetchone()
    assert email is not None
    assert tokens.account(email[0]) == "dt1"
    assert tokens.account("nobody@example.test") is None
