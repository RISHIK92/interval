import type { DB } from "@interval/db";
import { type Kysely, type RawBuilder, sql } from "kysely";
import { z } from "zod";
import {
  ASK_CHIPS,
  ASK_MAX_FOLLOW_UPS,
  type AskChip,
  type AskCitation,
  type AskOutcome,
  type Asks,
  type AskThread,
  isTopic,
} from "../ports";

// ADR-0046 (AI-3): Explore's questions and, apart from them and from all source text,
// the worker's answers. A citation is stored as ids; its chip's label is read here from
// the catalogue, so the answer row never holds a title or a passage.

// What the worker writes (interval_jobs.ask): ids as strings. ADR-0058: a reading is
// its article.
const StoredCitation = z.union([
  z.object({ passage: z.string(), item_id: z.string() }),
  z.object({ passage: z.string(), concept_id: z.string() }),
]);
const StoredCitations = z.array(StoredCitation);

const OUTCOMES = [
  "answered",
  "nothing_found",
  "over_budget",
  "unavailable",
] as const satisfies readonly AskOutcome[];

const chipOf = (value: string | null): AskChip | null =>
  ASK_CHIPS.find((c) => c === value) ?? null;

// The gateway's UNMETERED providers (workers/jobs/src/interval_jobs/ai/gateway.py): never
// counted against a budget (owner, 2026-10-28).
const UNMETERED = ["voyage"];

type QuestionRow = {
  id: string;
  text: string;
  chip: string | null;
  asked_at: Date;
  depth: number;
  outcome: string | null;
  answer: string | null;
  citations: unknown;
};

async function citationsOf(
  db: Kysely<DB>,
  stored: unknown,
): Promise<AskCitation[]> {
  const parsed = StoredCitations.safeParse(stored);
  // The worker writes them from one schema; a malformed row shows no chips, never
  // a wrong one.
  if (!parsed.success) return [];
  const readingIds = parsed.data.flatMap((c) =>
    "item_id" in c ? [c.item_id] : [],
  );
  const conceptIds = parsed.data.flatMap((c) =>
    "concept_id" in c ? [c.concept_id] : [],
  );
  const items =
    readingIds.length === 0
      ? []
      : (
          await sql<{
            id: string;
            title: string;
            source_name: string;
            topic: string | null;
            broken: boolean;
          }>`
            select ci.id, ci.title, s.name as source_name,
                   ci.link_broken_at is not null or not s.active as broken,
                   (select t.v from unnest(s.topics) with ordinality t(v, i)
                    where t.v = any(enum_range(null::topic)::text[])
                    order by t.i limit 1) as topic
            from content_item ci join source s on s.id = ci.source_id
            where ci.id = any(${readingIds}::bigint[])
          `.execute(db)
        ).rows;
  const concepts =
    conceptIds.length === 0
      ? []
      : await db
          .selectFrom("concept")
          .select(["id", "name", "topic"])
          .where("id", "in", conceptIds)
          .execute();
  return parsed.data.flatMap((c): AskCitation[] => {
    if ("concept_id" in c) {
      const concept = concepts.find((r) => r.id === c.concept_id);
      return concept === undefined
        ? []
        : [
            {
              kind: "explainer",
              passage: c.passage,
              label: `Explainer · ${concept.name}`,
              topic: isTopic(concept.topic) ? concept.topic : null,
            },
          ];
    }
    const item = items.find((r) => r.id === c.item_id);
    // A link that broke since, or a source switched off, isn't offered.
    if (item === undefined || item.broken) return [];
    return [
      {
        kind: "reading",
        passage: c.passage,
        itemId: item.id,
        label: `${item.source_name} · ${item.title}`,
        topic: item.topic !== null && isTopic(item.topic) ? item.topic : null,
      },
    ];
  });
}

// The question, how deep in its thread it is, and its answer when there is one.
const threadSelect = (where: RawBuilder<unknown>) => sql<QuestionRow>`
  with recursive chain(id, follow_up_of, depth) as (
    select q.id, q.follow_up_of, 0 from ask_question q where ${where}
    union all
    select c.id, p.follow_up_of, c.depth + 1
    from chain c join ask_question p on p.id = c.follow_up_of
  )
  select q.id, q.text, q.chip, q.asked_at,
         (select max(depth) from chain c where c.id = q.id)::integer as depth,
         a.outcome, a.text as answer, a.citations
  from ask_question q
  left join ask_answer a on a.question_id = q.id
  where ${where}
  order by q.asked_at desc
  limit 1`;

export function kyselyAsks(db: Kysely<DB>): Asks {
  const thread = async (row: QuestionRow | undefined) => {
    if (row === undefined) return null;
    const outcome = OUTCOMES.find((o) => o === row.outcome);
    const view: AskThread = {
      id: row.id,
      text: row.text,
      chip: chipOf(row.chip),
      askedAt: row.asked_at,
      depth: row.depth,
      answer:
        outcome === undefined
          ? null
          : {
              outcome,
              text: outcome === "answered" ? row.answer : null,
              citations:
                outcome === "answered"
                  ? await citationsOf(db, row.citations)
                  : [],
            },
    };
    return view;
  };

  return {
    submit: async (userId, ask) => {
      if (ask.followUpOf !== null) {
        const parent = await thread(
          (
            await threadSelect(
              sql`q.id = ${ask.followUpOf}::uuid and q.user_id = ${userId}`,
            ).execute(db)
          ).rows[0],
        );
        if (parent === null) return "no_thread";
        if (parent.depth + 1 > ASK_MAX_FOLLOW_UPS) return "thread_full";
      }
      const created = await db
        .insertInto("ask_question")
        .values({
          user_id: userId,
          text: ask.text,
          chip: ask.chip,
          idempotency_key: ask.idempotencyKey,
          follow_up_of: ask.followUpOf,
        })
        .onConflict((c) =>
          c.columns(["user_id", "idempotency_key"]).doNothing(),
        )
        .returning("id")
        .executeTakeFirst();
      if (created !== undefined) return { id: created.id, created: true };
      const same = await db
        .selectFrom("ask_question")
        .select("id")
        .where("user_id", "=", userId)
        .where("idempotency_key", "=", ask.idempotencyKey)
        .executeTakeFirstOrThrow();
      return { id: same.id, created: false };
    },

    existing: async (userId, idempotencyKey) => {
      const row = await db
        .selectFrom("ask_question")
        .select("id")
        .where("user_id", "=", userId)
        .where("idempotency_key", "=", idempotencyKey)
        .executeTakeFirst();
      return row?.id ?? null;
    },

    drop: async (id) => {
      await db
        .deleteFrom("ask_question")
        .where("id", "=", id)
        // Never one the worker already answered.
        .where(
          sql<boolean>`not exists (
          select 1 from ask_answer a where a.question_id = ask_question.id)`,
        )
        .execute();
    },

    get: async (id, userId) =>
      thread(
        (
          await threadSelect(
            sql`q.id = ${id}::uuid and q.user_id = ${userId}`,
          ).execute(db)
        ).rows[0],
      ),

    latest: async (userId) =>
      thread(
        (await threadSelect(sql`q.user_id = ${userId}`).execute(db)).rows[0],
      ),

    remove: async (id, userId) => {
      const gone = await db
        .deleteFrom("ask_question")
        .where("id", "=", id)
        .where("user_id", "=", userId)
        .returning("id")
        .execute();
      return gone.length > 0;
    },

    sessionArticles: async (id, userId) => {
      const answer = await db
        .selectFrom("ask_answer as a")
        .innerJoin("ask_question as q", "q.id", "a.question_id")
        .select("a.citations")
        .where("a.question_id", "=", id)
        .where("q.user_id", "=", userId)
        .where("a.outcome", "=", "answered")
        .executeTakeFirst();
      if (answer === undefined) return null;
      const parsed = StoredCitations.safeParse(answer.citations);
      // ADR-0058: each cited article once, in citation order.
      const cited = parsed.success
        ? [
            ...new Set(
              parsed.data.flatMap((c) => ("item_id" in c ? [c.item_id] : [])),
            ),
          ]
        : [];
      if (cited.length === 0) return { articles: [], prerequisites: [] };
      // Only articles the feed itself would open now (broken links, the user's
      // hidden sources, inactive sources, duplicates); a link to the publisher's
      // page needs no full-text rights (ING-2).
      const { rows } = await sql<{
        item_id: string;
        title: string;
        source_name: string;
        minutes: number | null;
        concept_ids: string[];
      }>`
        select ci.id as item_id, ci.title, s.name as source_name,
               item_minutes(ci.id) as minutes,
               array(select ic.concept_id::text from item_concept ic
                     where ic.content_item_id = ci.id) as concept_ids
        from content_item ci
        join source s on s.id = ci.source_id
        where ci.id = any(${cited}::bigint[])
          and ci.link_broken_at is null and s.active and ci.duplicate_of is null
          and not exists (select 1 from user_hidden_source h
                          where h.user_id = ${userId} and h.source_id = s.id)
      `.execute(db);
      const articles = cited.flatMap((itemId) => {
        const r = rows.find((row) => row.item_id === itemId);
        return r === undefined
          ? []
          : [
              {
                itemId: r.item_id,
                title: r.title,
                sourceName: r.source_name,
                minutes: r.minutes,
                conceptIds: r.concept_ids,
              },
            ];
      });
      const concepts = [...new Set(articles.flatMap((a) => a.conceptIds))];
      const edges =
        concepts.length === 0
          ? []
          : await db
              .selectFrom("concept_edge")
              .select(["from_id", "to_id"])
              .where("type", "=", "prerequisite_of")
              .where("from_id", "in", concepts)
              .where("to_id", "in", concepts)
              .execute();
      return {
        articles,
        prerequisites: edges.map((e): [string, string] => [e.from_id, e.to_id]),
      };
    },

    askedSince: async (userId, since) => {
      // Owner, 2026-11-26: counted from ai_usage, which a deleted question leaves
      // behind. The worker embeds each question once under feature "ask" (an
      // embedding has no output tokens); stored questions cover those still queued.
      const row = await sql<{ n: number }>`
        select greatest(
          (select count(*) from ai_usage
           where user_id = ${userId} and feature = 'ask' and output_tokens = 0
             and occurred_at >= ${since}),
          (select count(*) from ask_question
           where user_id = ${userId} and asked_at >= ${since})
        )::integer as n
      `
        .execute(db)
        .then((r) => r.rows[0]);
      return row?.n ?? 0;
    },

    spentToday: async (userId, dayStart) => {
      const end = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const row = await sql<{
        user_usd: string;
        global_usd: string;
        cap: number | null;
      }>`
        select
          (select coalesce(sum(cost_usd), 0) from ai_usage
           where user_id = ${userId} and occurred_at >= ${dayStart}
             and occurred_at < ${end}
             and provider <> all(${UNMETERED}::ai_provider[])) as user_usd,
          (select coalesce(sum(cost_usd), 0) from ai_usage
           where is_offline and occurred_at >= ${dayStart} and occurred_at < ${end}
             and provider <> all(${UNMETERED}::ai_provider[])) as global_usd,
          (select daily_cents from ai_budget where scope = 'global') as cap
      `
        .execute(db)
        .then((r) => r.rows[0]);
      if (row?.cap == null)
        throw new Error("ai_budget has no global row (see migrations)");
      return {
        userUsd: Number(row.user_usd),
        globalUsd: Number(row.global_usd),
        globalCapCents: row.cap,
      };
    },
  };
}
