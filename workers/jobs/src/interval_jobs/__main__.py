"""Worker CLI.

Usage:
  python -m interval_jobs ingest-one --name N --feed-url URL --rights-profile P
  python -m interval_jobs segment-item --content-item-id ID
  python -m interval_jobs rebuild-feed
"""

import argparse
import json
import os
import sys
from typing import get_args

import httpx
import psycopg
from psycopg.conninfo import conninfo_to_dict

from interval_db.generated import RightsProfile
from interval_jobs.feed.precompute import rebuild_feed
from interval_jobs.ingest.one import ingest_one
from interval_jobs.segment import segment_item
from interval_jobs.sources import upsert_source

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
USER_AGENT = "Interval/0.0 (personal learning platform; feed reader)"


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set; copy .env.example to .env")
    # CLAUDE.md: never touch a non-local database. Parse as libpq does, so `?host=` or
    # `?hostaddr=` in the query cannot override the host in the URL.
    params = conninfo_to_dict(url)
    hosts = {
        str(params.get("host") or "localhost"),
        str(params.get("hostaddr") or "127.0.0.1"),
    }
    if not hosts <= LOCAL_HOSTS and os.environ.get("CI") != "true":
        sys.exit(
            f"Refusing to touch database host {sorted(hosts)}: "
            "only localhost outside CI."
        )
    return url


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="interval_jobs")
    commands = parser.add_subparsers(dest="command", required=True)
    one = commands.add_parser("ingest-one", help="ingest the newest item of one feed")
    one.add_argument("--name", required=True)
    one.add_argument("--feed-url", required=True)
    one.add_argument(
        "--rights-profile", required=True, choices=get_args(RightsProfile.__value__)
    )
    one.add_argument("--homepage")
    seg = commands.add_parser("segment-item", help="split one stored item into moments")
    seg.add_argument("--content-item-id", type=int, required=True)
    commands.add_parser("rebuild-feed", help="recompute the precomputed feed")
    args = parser.parse_args(argv)

    with psycopg.connect(_database_url()) as conn:
        if args.command == "rebuild-feed":
            entries = rebuild_feed(conn)
            conn.commit()
            print(json.dumps({"feed_entries": entries}))
            return
        if args.command == "segment-item":
            rows = segment_item(conn, args.content_item_id)
            rebuild_feed(conn)
            conn.commit()
            print(
                json.dumps(
                    {"content_item_id": args.content_item_id, "moments": len(rows)}
                )
            )
            return
        with httpx.Client(headers={"user-agent": USER_AGENT}) as http:
            source_id = upsert_source(
                conn,
                name=args.name,
                feed_url=args.feed_url,
                rights_profile=args.rights_profile,
                homepage=args.homepage,
            )
            result = ingest_one(conn, http, source_id)
        conn.commit()
    print(
        json.dumps({"content_item_id": result.content_item_id, "stored": result.stored})
    )


if __name__ == "__main__":
    main(sys.argv[1:])
