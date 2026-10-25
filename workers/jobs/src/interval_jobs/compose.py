"""Composition root (ADR-0012): the only place that builds adapters.

Every process (the CLI and the queue consumer) gets its ports from here, so
swapping a service means changing this file and one adapter.
"""

import os
import sys
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import boto3  # pyright: ignore[reportMissingTypeStubs]
import httpx
import psycopg
from psycopg.conninfo import conninfo_to_dict

from interval_jobs import log
from interval_jobs.adapters.bullmq_queue import BullmqConsumer, BullmqQueue
from interval_jobs.adapters.file_sink import FileEventSink
from interval_jobs.adapters.firehose_sink import FirehoseClient, FirehoseEventSink
from interval_jobs.adapters.http_fetcher import HttpxFetcher
from interval_jobs.adapters.openrouter import OpenRouterClient
from interval_jobs.adapters.polite_fetcher import PoliteFetcher
from interval_jobs.adapters.postgres import PostgresAi, PostgresStore, unit_of_work
from interval_jobs.adapters.sqs_queue import SqsClient, SqsConsumer, SqsQueue
from interval_jobs.adapters.trafilatura_extractor import TrafilaturaExtractor
from interval_jobs.adapters.voyage import VoyageClient
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.events.emitter import Emitter
from interval_jobs.pipeline import StageServices, Tagging, UnitOfWork
from interval_jobs.ports import AiLedger, EventSink, JobQueue, QueueConsumer

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
USER_AGENT = "Interval/0.0 (personal learning platform; feed reader)"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set; copy .env.example to .env")
    # CLAUDE.md: never touch a non-local database. Parse as libpq does, so `?host=` or
    # `?hostaddr=` in the query cannot override the host in the URL. On the VM the
    # database is the compose service `postgres`; write-env.sh lists it explicitly. Only
    # compose-style service names count: entries with a dot or colon (a domain or an IP
    # address) are ignored, so the allowlist can never open a remote host.
    entries = (e.strip() for e in os.environ.get("ALLOWED_DB_HOSTS", "").split(","))
    allowed = LOCAL_HOSTS | {e for e in entries if e and "." not in e and ":" not in e}
    params = conninfo_to_dict(url)
    hosts = {
        str(params.get("host") or "localhost"),
        str(params.get("hostaddr") or "127.0.0.1"),
    }
    # The guard protects developer machines. Deployed tasks set INTERVAL_RUNTIME=aws
    # (infra/src/aws-stack.ts), where the database is RDS by design.
    deployed = os.environ.get("INTERVAL_RUNTIME") == "aws"
    if not hosts <= allowed and os.environ.get("CI") != "true" and not deployed:
        sys.exit(
            f"Refusing to touch database host {sorted(hosts)}: "
            "only localhost (or ALLOWED_DB_HOSTS) outside CI."
        )
    return url


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"{name} is not set; see .env.example")
    return value


def event_sink() -> EventSink:
    """DB-5: Firehose when deployed (both modes), a JSON-lines file in development."""
    transport = os.environ.get("EVENTS_TRANSPORT")
    if transport == "file":
        return FileEventSink(Path(_required("EVENTS_DIR")))
    if transport == "firehose":
        stream = _required("EVENTS_STREAM")
        # boto3 is untyped; the adapter's protocol names the one call it makes.
        client = cast(
            FirehoseClient,
            boto3.client(  # pyright: ignore[reportUnknownMemberType]
                "firehose", region_name=_required("AWS_REGION")
            ),
        )
        return FirehoseEventSink(client, stream)
    sys.exit("EVENTS_TRANSPORT must be file or firehose; see .env.example")


def _sqs_client() -> SqsClient:
    # boto3 is untyped; the adapter's protocol names the calls it makes.
    return cast(
        SqsClient,
        boto3.client(  # pyright: ignore[reportUnknownMemberType]
            "sqs", region_name=_required("AWS_REGION")
        ),
    )


def _queue_transport() -> str:
    transport = os.environ.get("QUEUE_TRANSPORT")
    if transport not in ("bullmq", "sqs"):
        sys.exit("QUEUE_TRANSPORT must be bullmq or sqs; see .env.example")
    return transport


def queue_for_enqueue() -> JobQueue:
    """ADR-0014: BullMQ on Valkey (local, VM) or SQS (full AWS)."""
    if _queue_transport() == "bullmq":
        return BullmqQueue(_required("VALKEY_URL"))
    prefix = _required("SQS_QUEUE_URL_PREFIX")
    return SqsQueue(_sqs_client(), prefix)


def queue_consumer() -> QueueConsumer:
    if _queue_transport() == "bullmq":
        return BullmqConsumer(_required("VALKEY_URL"))
    prefix = _required("SQS_QUEUE_URL_PREFIX")
    return SqsConsumer(_sqs_client(), prefix)


@dataclass(frozen=True)
class Services:
    store: PostgresStore
    fetcher: PoliteFetcher
    extractor: TrafilaturaExtractor
    events: Emitter
    ai: PostgresAi


@contextmanager
def services() -> Generator[Services]:
    """One unit of work plus the web and parsing adapters; commits on success.

    Events are flushed when the unit of work ends, whether or not it succeeded. The AI
    ledger has its own autocommit connection: a model call is paid for when it returns,
    so its usage row must outlive a job that fails afterwards (OPS-4).
    """
    url = database_url()
    events = Emitter(event_sink())
    try:
        with (
            unit_of_work(url) as store,
            psycopg.connect(url, autocommit=True) as ledger,
            httpx.Client(headers={"user-agent": USER_AGENT}) as http,
        ):
            yield Services(
                store,
                PoliteFetcher(HttpxFetcher(http)),
                TrafilaturaExtractor(),
                events,
                PostgresAi(ledger),
            )
    finally:
        events.flush()


@contextmanager
def stage_units() -> Generator[UnitOfWork]:
    """Units of work for the pipeline's stages, sharing one web client and extractor.

    A stage's unit is only its database transaction: no event sink, AI ledger or web
    client per delivery.
    """
    url = database_url()
    with httpx.Client(headers={"user-agent": USER_AGENT}) as http:
        # One polite fetcher per process: robots.txt and per-domain spacing are shared
        # by every stage thread (ING-1).
        fetcher = PoliteFetcher(HttpxFetcher(http))
        extractor = TrafilaturaExtractor()

        @contextmanager
        def unit() -> Generator[StageServices]:
            with unit_of_work(url) as store:
                yield StageServices(store, fetcher, extractor)

        yield unit


def ai_gateway(ledger: AiLedger, http: httpx.Client) -> AiGateway:
    """The one way to a model (ADR-0008): OpenRouter and Voyage AI (ADR-0007)."""
    return AiGateway(
        ledger,
        OpenRouterClient(http, _required("OPENROUTER_API_KEY")),
        VoyageClient(http, os.environ.get("VOYAGE_API_KEY") or None),
    )


@contextmanager
def tagging() -> Generator[Tagging | None]:
    """Concept tagging (P1-W3-S02) with the model the tagging eval picked
    (ADR-0010); off until TAGGING_MODEL is set. Each call gets a short autocommit
    ledger connection: a paid call is recorded even if its stage then fails (OPS-4).
    """
    model = os.environ.get("TAGGING_MODEL")
    if not model:
        log.info("tagging: off (TAGGING_MODEL is not set)")
        yield None
        return
    url = database_url()
    with httpx.Client() as http:

        @contextmanager
        def gateway() -> Generator[AiGateway]:
            with psycopg.connect(url, autocommit=True) as ledger:
                yield ai_gateway(PostgresAi(ledger), http)

        yield Tagging(model, gateway)
