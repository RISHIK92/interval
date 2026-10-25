import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Envelope } from "@interval/events";
import type { EventSink } from "../ports";

// Development events (owner, 2026-10-25): one JSON line per event, a file per UTC day.
export function fileSink(dir: string): EventSink {
  return {
    write: async (batch) => {
      await mkdir(dir, { recursive: true });
      const byDay = new Map<string, Envelope[]>();
      for (const event of batch) {
        const day = event.occurred_at.slice(0, 10);
        const events = byDay.get(day);
        if (events === undefined) byDay.set(day, [event]);
        else events.push(event);
      }
      for (const [day, events] of byDay) {
        const lines = events.map((e) => `${JSON.stringify(e)}\n`).join("");
        await appendFile(path.join(dir, `${day}.jsonl`), lines);
      }
      return { failed: [] };
    },
  };
}
