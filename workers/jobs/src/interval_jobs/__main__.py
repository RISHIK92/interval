"""Worker CLI.

Usage:
  python -m interval_jobs ingest-one --name N --feed-url URL --rights-profile P
  python -m interval_jobs segment-item --content-item-id ID
  python -m interval_jobs rebuild-feed
  python -m interval_jobs issue-invites --group student --uses 30 --days 30 [--count N]
"""

import argparse
import json
import sys
from typing import get_args

from interval_db.generated import BetaGroup, RightsProfile
from interval_jobs.compose import services
from interval_jobs.feed.precompute import rebuild_feed
from interval_jobs.ingest.one import ingest_one
from interval_jobs.invites import MAX_COUNT, display, issue_invites
from interval_jobs.segment import segment_item


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
    inv = commands.add_parser("issue-invites", help="issue private-beta invite codes")
    inv.add_argument("--group", required=True, choices=get_args(BetaGroup.__value__))
    inv.add_argument("--uses", type=int, required=True, help="1 = personal code")
    inv.add_argument("--days", type=int, required=True, help="valid for this many days")
    inv.add_argument("--count", type=int, default=1)
    inv.add_argument("--note")
    args = parser.parse_args(argv)

    if args.command == "issue-invites":
        if args.uses < 1 or args.days < 1 or not 1 <= args.count <= MAX_COUNT:
            parser.error(f"--uses and --days must be >= 1; --count 1..{MAX_COUNT}")
        with services() as s:
            codes = issue_invites(
                s.store,
                group=args.group,
                uses=args.uses,
                days=args.days,
                count=args.count,
                note=args.note,
            )
        print("\n".join(display(code) for code in codes))
        return

    with services() as s:
        if args.command == "rebuild-feed":
            result: dict[str, object] = {"feed_entries": rebuild_feed(s.store)}
        elif args.command == "segment-item":
            rows = segment_item(s.store, args.content_item_id)
            rebuild_feed(s.store)
            result = {"content_item_id": args.content_item_id, "moments": len(rows)}
        else:
            source_id = s.store.sources.upsert(
                name=args.name,
                feed_url=args.feed_url,
                rights_profile=args.rights_profile,
                homepage=args.homepage,
            )
            ingested = ingest_one(s.store, s.fetcher, s.extractor, source_id)
            result = {
                "content_item_id": ingested.content_item_id,
                "stored": ingested.stored,
            }
    print(json.dumps(result))


if __name__ == "__main__":
    main(sys.argv[1:])
