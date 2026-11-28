import type { AgentStatus } from "@interval/api-client";
import { env } from "../../../../env";
import {
  agentHook,
  entitlements,
  feedReader,
  preferences,
} from "../../../../server/container";
import { outHref, readHref } from "../../../../server/outbound";
import type { FeedCard } from "../../../../server/ports";
import { deviceRequest } from "../hook";

export const dynamic = "force-dynamic";

// P7-W46 (§7; Q-P7-02, owner 2026-11-20 and 2026-11-27): what the companion surfaces
// read with the hook's device token: the agent's task as the hooks reported it, and 3
// suggestions from the precomputed feed (CACHE-1) as links into the web app. Nothing
// here comes from the agent but "started" and "finished" (there is nothing else).
const SUGGESTIONS = 3;
// A surface polls; a few times a second for a minute is a leak or a loop.
const PER_MINUTE = 60;

export async function GET(request: Request): Promise<Response> {
  const now = new Date();
  // A read: Profile's "Last used" stays the hook's own (touch: false).
  const device = await deviceRequest(request, now, {
    bucket: "agent-status",
    perMinute: PER_MINUTE,
    touch: false,
  });
  if (device instanceof Response) return device;
  // ADR-0058: no time chips; a ?chip= the CLI or the extension still sends is ignored.
  const { userId } = device.actor;
  const [running, finished, chosen, reads] = await Promise.all([
    agentHook().running(userId, now),
    agentHook().finished(userId, now),
    preferences().get(userId),
    entitlements().can(userId, "feed.read"),
  ]);
  const task: AgentStatus["task"] =
    running !== null
      ? {
          state: "running",
          startedAt: running.startedAt.toISOString(),
          seconds: Math.max(
            0,
            Math.floor((now.getTime() - running.startedAt.getTime()) / 1000),
          ),
        }
      : finished !== null
        ? { state: "finished", finishedAt: finished.finishedAt.toISOString() }
        : { state: "idle" };
  // Before onboarding, or on a plan without the feed, no suggestions.
  // The stored feed as it is, else the starter (ADR-0008), read directly: a polled
  // read neither waits for a first recompute nor counts in Home's feed-latency log
  // line (OPS-2), as loadFeed would.
  let cards: FeedCard[] = [];
  if (chosen !== null && reads) {
    const stored = await feedReader().read(userId, SUGGESTIONS);
    const [topic] = chosen.topics;
    cards = stored.computed
      ? stored.cards
      : topic === undefined
        ? []
        : await feedReader().starter(userId, topic, chosen.level, SUGGESTIONS);
  }
  const site = env().BETTER_AUTH_URL;
  const body: AgentStatus = {
    task,
    suggestions: cards.slice(0, SUGGESTIONS).map((card, index) => ({
      title: card.articleTitle,
      minutes:
        card.estimatedMinutes === null
          ? null
          : Math.max(1, Math.round(card.estimatedMinutes)),
      url: new URL(link(card, index + 1), site).toString(),
    })),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

// As Home opens the card (the in-app reader when the page may be framed, ADR-0018),
// counted as offered via the agent (owner, 2026-11-27).
function link(card: FeedCard, position: number): string {
  const from = { position, via: "agent" } as const;
  return card.frameable
    ? readHref({ itemId: card.itemId, from })
    : outHref({ itemId: card.itemId, target: "article", from });
}
