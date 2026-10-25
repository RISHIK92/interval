import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Envelope } from "@interval/events";
import { expect, test } from "vitest";
import { fileSink } from "./file-sink";

function event(id: string, occurredAt: string): Envelope {
  return {
    event_id: id,
    name: "signup_completed",
    version: 1,
    occurred_at: occurredAt,
    user_id: "u1",
    is_guest: false,
    beta_group: "student",
    session_id: null,
    source: "web",
    props: {},
  };
}

// Development events (owner, 2026-10-25): one JSON line per event in a file per UTC day.
test("events are appended as JSON lines to the file for their UTC day", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "events-"));
  const sink = fileSink(path.join(dir, "nested"));
  const a = event(
    "6f1c1f3e-0b7a-4c55-9d43-0d6a1f0b2c11",
    "2026-10-25T23:59:59.000Z",
  );
  const b = event(
    "7f1c1f3e-0b7a-4c55-9d43-0d6a1f0b2c11",
    "2026-10-26T00:00:00.000Z",
  );
  expect(await sink.write([a, b])).toEqual({ failed: [] });
  expect(await sink.write([a])).toEqual({ failed: [] });
  const files = readdirSync(path.join(dir, "nested")).sort();
  expect(files).toEqual(["2026-10-25.jsonl", "2026-10-26.jsonl"]);
  const day1 = readFileSync(
    path.join(dir, "nested", "2026-10-25.jsonl"),
    "utf8",
  );
  expect(day1.split("\n")).toEqual([JSON.stringify(a), JSON.stringify(a), ""]);
});
