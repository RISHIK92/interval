import type { Topic } from "@interval/db";
import { z } from "zod";
import type { Emitter, EventContext } from "./events";
import { log } from "./log";
import {
  ASK_CHIPS,
  ASK_MAX_CHARS,
  type Asks,
  type Entitlements,
  type JobQueue,
  type SessionArticle,
} from "./ports";

// ADR-0046: Explore's rules that aren't SQL. Ask is asked here and answered by the
// worker (ADR-0007, ADR-0008: TypeScript calls no model).

export const AskBody = z.object({
  text: z.string().trim().min(1).max(ASK_MAX_CHARS),
  chip: z.enum(ASK_CHIPS).nullable(),
  idempotencyKey: z.string().min(1).max(100),
  followUpOf: z.uuid().nullable(),
});
export type AskBody = z.infer<typeof AskBody>;

type AskRefusal = "daily_limit" | "user_budget" | "global_budget";

const utcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

// OPS-4: refused when the user has asked explore.ask.daily times today, their
// ai.budget.daily_cents is spent, or the global daily cap is (ADR-0038's 30 cents
// locally). The worker's gateway checks the budgets again before its call.
export async function askRefusal(
  deps: {
    asks: Pick<Asks, "askedSince" | "spentToday">;
    entitlements: Pick<Entitlements, "limit">;
  },
  userId: string,
  now: Date,
): Promise<AskRefusal | null> {
  const day = utcDay(now);
  const daily = await deps.entitlements.limit(userId, "explore.ask.daily");
  if (daily !== null && (await deps.asks.askedSince(userId, day)) >= daily)
    return "daily_limit";
  const cap = await deps.entitlements.limit(userId, "ai.budget.daily_cents");
  const spent = await deps.asks.spentToday(userId, day);
  if (cap !== null && spent.userUsd * 100 >= cap) return "user_budget";
  if (spent.globalUsd * 100 >= spent.globalCapCents) return "global_budget";
  return null;
}

export type AskResult =
  | { status: "queued"; id: string }
  | { status: "refused"; reason: AskRefusal }
  | { status: "no_thread" }
  | { status: "thread_full" };

// Stores the question and queues its answer; a retried submit (the same key) is the
// same question and queues nothing new (LOAD-5). Refusals are said, logged and
// counted, never silent. The question's text never enters an event.
export async function submitAsk(
  deps: {
    asks: Asks;
    entitlements: Pick<Entitlements, "limit">;
    queue: JobQueue;
    events: Pick<Emitter, "emit">;
  },
  context: EventContext,
  body: AskBody,
  now: Date,
): Promise<AskResult> {
  // A retry of a question already stored is that question, whatever today's limits
  // say now; it is neither refused nor counted again (LOAD-5).
  const stored = await deps.asks.existing(context.userId, body.idempotencyKey);
  if (stored !== null) return { status: "queued", id: stored };
  const refused = await askRefusal(deps, context.userId, now);
  if (refused !== null) {
    log.warn("explore: ask refused", { reason: refused });
    deps.events.emit(
      "ask_answered",
      { outcome: refused, citation_count: 0, cost_micro_usd: 0 },
      context,
    );
    return { status: "refused", reason: refused };
  }
  const asked = await deps.asks.submit(context.userId, body);
  if (asked === "no_thread" || asked === "thread_full")
    return { status: asked };
  if (asked.created) {
    try {
      await deps.queue.enqueue(
        "ask",
        { question_id: asked.id },
        { idempotencyKey: `ask-${asked.id}` },
      );
    } catch (error) {
      // Said and thrown; the question goes, so the user may ask again rather than
      // wait on an answer nobody will write.
      log.error("explore: ask not queued", { id: asked.id, error });
      await deps.asks.drop(asked.id);
      throw error;
    }
    deps.events.emit(
      "ask_submitted",
      {
        length: body.text.length,
        chip: body.chip ?? "none",
        follow_up: body.followUpOf !== null,
      },
      context,
    );
  }
  return { status: "queued", id: asked.id };
}

// An Ask answer's reading session (ADR-0046; owner, 2026-11-26): the cited articles in
// concept-prerequisite order (one teaching a prerequisite of another's concept comes
// first; otherwise citation order). ADR-0058 removed sizing reading to a break, so the
// session is the top SESSION_ARTICLES of that order, not a cut to some minutes.
const SESSION_ARTICLES = 3;

export function sessionPlan(
  articles: readonly SessionArticle[],
  prerequisites: readonly (readonly [string, string])[],
): SessionArticle[] {
  const before = (a: SessionArticle, b: SessionArticle) =>
    a !== b &&
    prerequisites.some(
      ([from, to]) => a.conceptIds.includes(from) && b.conceptIds.includes(to),
    );
  const ordered: SessionArticle[] = [];
  const left = [...articles];
  while (left.length > 0) {
    // The first in citation order that nothing left must precede; in a cycle, the
    // first left.
    const next =
      left.find((a) => !left.some((other) => before(other, a))) ?? left[0];
    if (next === undefined) break;
    ordered.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return ordered.slice(0, SESSION_ARTICLES);
}

// Following a space is choosing its topic (PER-1): the same list onboarding and Profile
// edit. Null when the change would leave no topic (a feed needs one) or the topic
// isn't one the user may choose.
export function followedTopics(
  current: readonly Topic[],
  topic: Topic,
  follow: boolean,
  offered: readonly Topic[],
): Topic[] | null {
  if (follow) {
    if (!offered.includes(topic) && !current.includes(topic)) return null;
    return current.includes(topic) ? [...current] : [...current, topic];
  }
  const left = current.filter((t) => t !== topic);
  return left.length === 0 ? null : left;
}

// ADR-0046 (Q-WD-22): a space's learner count shows only above 50.
export function learnersLabel(count: number): string | null {
  if (count <= 50) return null;
  if (count < 1000) return `${String(count)} learners`;
  const thousands = (Math.floor(count / 100) / 10).toFixed(1);
  return `${thousands.replace(/\.0$/, "")}k learners`;
}

// The design's space names (Explore, web): a short tag per topic.
export const SPACE_NAMES: Record<Topic, string> = {
  "system-design": "#system-design",
  databases: "#databases",
  "distributed-systems": "#distributed",
  backend: "#backend",
  "software-design": "#software-design",
};
