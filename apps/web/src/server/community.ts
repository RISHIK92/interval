import { z } from "zod";
import type { Emitter, EventContext } from "./events";
import { log } from "./log";
import {
  BIGINT_ID,
  COMMUNITY_OPTIONS,
  type CommunityQuestions,
  type Entitlements,
  type JobQueue,
} from "./ports";

// Q-P7-05 (owner, 2026-11-27, §6.8): community questions' rules that aren't SQL. Any
// account with a verified email on a plan with questions.submit may write one at the
// end of a section it opened, at most questions.submit.daily a UTC day. The second
// model checks it in the worker (ADR-0007, ADR-0008: TypeScript calls no model), then
// the owner.

// The limits of `question` itself, and of a drafted question's (questions.py): a quote
// of at least 3 words, so it can be checked against the section.
const STEM_CHARS = 500;
const OPTION_CHARS = 200;
const CITATION_CHARS = 300;
const CITATION_WORDS = 3;

const MESSAGES = {
  stem: `Write the question, up to ${String(STEM_CHARS)} characters.`,
  options: `Fill in all ${String(COMMUNITY_OPTIONS)} answers, up to ${String(OPTION_CHARS)} characters each.`,
  distinct: "Make the answers all different.",
  correct: "Choose which answer is correct.",
  citation: `Quote the section: at least ${String(CITATION_WORDS)} words, up to ${String(CITATION_CHARS)} characters.`,
} as const;
// The messages above; any other issue (a forged field) gets a plain one.
const SAID = new Set<string>(Object.values(MESSAGES));

// Case, spacing and punctuation aside, as the drafting rule compares options.
const plainWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim();

export const QuestionInput = z.object({
  momentId: z.string().regex(BIGINT_ID),
  stem: z.string().trim().min(1, MESSAGES.stem).max(STEM_CHARS, MESSAGES.stem),
  options: z
    .array(
      z
        .string()
        .trim()
        .min(1, MESSAGES.options)
        .max(OPTION_CHARS, MESSAGES.options),
    )
    .length(COMMUNITY_OPTIONS, MESSAGES.options)
    .refine(
      (options) => new Set(options.map(plainWords)).size === COMMUNITY_OPTIONS,
      MESSAGES.distinct,
    ),
  correct: z.coerce
    .number(MESSAGES.correct)
    .int(MESSAGES.correct)
    .min(0, MESSAGES.correct)
    .max(COMMUNITY_OPTIONS - 1, MESSAGES.correct),
  citation: z
    .string()
    .trim()
    .max(CITATION_CHARS, MESSAGES.citation)
    .refine(
      (quote) => quote.split(/\s+/).filter(Boolean).length >= CITATION_WORDS,
      MESSAGES.citation,
    ),
  idempotencyKey: z.string().min(1).max(100),
});
export type QuestionInput = z.infer<typeof QuestionInput>;

// The daily count's day starts at 00:00 UTC, as explore.ask.daily's.
export const utcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

// What the end of a section offers: "write" for a verified account, "verify" for one
// that isn't (Profile sends the link), null where no question may be written (a plan
// without questions.submit, or a section the user didn't open or the check can't read).
export async function writeOffer(
  deps: {
    community: Pick<CommunityQuestions, "allowance" | "section">;
    entitlements: Pick<Entitlements, "can">;
  },
  userId: string,
  momentId: string,
  now: Date,
): Promise<"write" | "verify" | null> {
  if (!(await deps.entitlements.can(userId, "questions.submit"))) return null;
  if ((await deps.community.section(userId, momentId)) === null) return null;
  const { verified } = await deps.community.allowance(userId, utcDay(now));
  return verified ? "write" : "verify";
}

// How many more the user may submit today (UTC); null without a limit.
export async function remainingToday(
  deps: {
    community: Pick<CommunityQuestions, "allowance">;
    entitlements: Pick<Entitlements, "limit">;
  },
  userId: string,
  now: Date,
): Promise<number | null> {
  const limit = await deps.entitlements.limit(userId, "questions.submit.daily");
  if (limit === null) return null;
  const { used } = await deps.community.allowance(userId, utcDay(now));
  return Math.max(0, limit - used);
}

export type SubmitResult =
  | { status: "submitted"; id: string; remaining: number | null }
  | { status: "invalid"; message: string }
  | { status: "refused"; reason: "unverified" | "daily_limit" | "no_section" };

// Stores the question pending and queues its check; a retried submit (the same key)
// is the same question and queues nothing new (LOAD-5). Refusals are said and logged,
// never silent. The question's text never enters an event or a log line. The caller
// has checked the account and its questions.submit.
export async function submitQuestion(
  deps: {
    community: Pick<CommunityQuestions, "allowance" | "submit" | "drop">;
    entitlements: Pick<Entitlements, "limit">;
    queue: JobQueue;
    events: Pick<Emitter, "emit">;
  },
  context: EventContext,
  raw: unknown,
  now: Date,
): Promise<SubmitResult> {
  const parsed = QuestionInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      status: "invalid",
      message:
        first !== undefined && SAID.has(first.message)
          ? first.message
          : "Check the question and try again.",
    };
  }
  const since = utcDay(now);
  const { verified } = await deps.community.allowance(context.userId, since);
  if (!verified) {
    log.info("community: submission refused", { reason: "unverified" });
    return { status: "refused", reason: "unverified" };
  }
  const limit = await deps.entitlements.limit(
    context.userId,
    "questions.submit.daily",
  );
  const saved = await deps.community.submit(context.userId, parsed.data, {
    since,
    limit,
  });
  if (saved === "daily_limit" || saved === "no_section") {
    log.info("community: submission refused", { reason: saved });
    return { status: "refused", reason: saved };
  }
  const remaining = limit === null ? null : Math.max(0, limit - saved.used);
  // A retry queues the check again under the same key (LOAD-5): if the first submit
  // died between its commit and its enqueue, nothing else would. A check already done
  // or waiting is a no-op (the worker skips a checked question; the queue, a key).
  try {
    await deps.queue.enqueue(
      "validate_question",
      { question_id: Number(saved.id), attempt: 0, broken: 0 },
      { idempotencyKey: `validate-${saved.id}` },
    );
  } catch (error) {
    log.error("community: check not queued", { id: saved.id, error });
    // A new question goes, so the user may submit it again rather than wait on a
    // check nobody will run; a retried one stays for the next retry.
    if (saved.created) await deps.community.drop(saved.id);
    throw error;
  }
  if (saved.created)
    deps.events.emit(
      "question_submitted",
      {
        question_id: saved.id,
        moment_id: parsed.data.momentId,
        limited: remaining !== null,
        remaining_today: remaining ?? 0,
      },
      context,
    );
  return { status: "submitted", id: saved.id, remaining };
}
