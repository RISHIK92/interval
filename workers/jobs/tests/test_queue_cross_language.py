"""The production path (ADR-0014): the web app enqueues with BullMQ for Node, and the
worker consumes with BullMQ for Python. A job format or script mismatch between the
two pinned versions would only show up here."""

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel

from interval_db.messages import DiscoverSource
from interval_jobs.adapters.bullmq_queue import BullmqConsumer, BullmqQueue
from interval_jobs.ports import Delivery

WEB = Path(__file__).resolve().parents[3] / "apps" / "web"

# Node's bullmq, resolved from apps/web (the version the web app runs).
ENQUEUE = """
import { Queue } from "bullmq";
const [url, prefix] = process.argv.slice(1);
const queue = new Queue("discover_source", { connection: { url }, prefix });
await queue.add("discover_source", { source_id: 11 }, {
  jobId: "from-node", attempts: 3, backoff: { type: "exponential", delay: 20 },
  removeOnComplete: true, removeOnFail: false,
});
await queue.close();
"""


def test_a_job_enqueued_by_node_is_consumed_by_python() -> None:
    url = os.environ.get("VALKEY_URL")
    assert url, "VALKEY_URL is not set; see .env.example"
    prefix = f"test-{uuid4().hex}"
    subprocess.run(
        ["node", "--input-type=module", "-e", ENQUEUE, url, prefix],
        cwd=WEB,
        check=True,
        timeout=60,
    )
    seen: list[tuple[int, int, str]] = []

    def handler(message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, DiscoverSource)
        seen.append((message.source_id, delivery.attempt, delivery.idempotency_key))

    queue = BullmqQueue(url, prefix=prefix)
    stop = threading.Event()
    worker = threading.Thread(
        target=BullmqConsumer(url, prefix=prefix).consume,
        args=("discover_source", handler, stop),
    )
    worker.start()
    try:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and not seen:
            time.sleep(0.05)
    finally:
        stop.set()
        worker.join(timeout=15)
        queue.close(delete=True)
    assert seen == [(11, 1, "from-node")], json.dumps(seen)
