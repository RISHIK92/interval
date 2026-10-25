"""Worker CLI.

Usage:
  python -m interval_jobs ingest-one --name N --feed-url URL --rights-profile P
  python -m interval_jobs segment-item --content-item-id ID
  python -m interval_jobs rebuild-feed
"""

import argparse
import json
import sys
from typing import get_args

from interval_db.generated import RightsProfile
from interval_jobs.compose import services
from interval_jobs.feed.precompute import rebuild_feed
from interval_jobs.ingest.one import ingest_one
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
    args = parser.parse_args(argv)

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
