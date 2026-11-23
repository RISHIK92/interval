// Demo data for design comparison: fills a local database with sample metadata so every
// page shows its full state (owner, 2026-11-23). Local databases only: DATABASE_URL and
// VALKEY_URL must name a local host, a hostname check like load:prepare's, so a remote
// database or Valkey tunnelled to localhost would pass it. No model is called: the
// questions and the path are written here and marked `demo-seed` where a model's name
// would go. Everything it makes is recognisable (sources "Demo · …", guids, concept
// slugs and content hashes "demo-…", fixed match ids), and a rerun upserts the same
// rows, leaving a user's own choices alone (PER-1): a kept onboarding shapes that user's
// seeded feed and its reasons. No full text is stored (ING-2): titles, headings, word
// counts and deep links only.
//
// daily_challenge is global, not per user: the seed approves a demo daily for each of
// the last five days (a day that already has one keeps it, plus any demo question in a
// free position), so every account in the database sees them, and the live demo
// questions can be drawn by the real sprint and daily pickers locally.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BreakLength,
  DB,
  Difficulty,
  LearnerState,
  LearningGoal,
  Topic,
} from "@interval/db";
import { Redis } from "ioredis";
import { type Kysely, sql } from "kysely";
import { createDb } from "../src/server/adapters/kysely";
import { valkeyLeaderboards } from "../src/server/adapters/valkey-leaderboards";
import { GOALS, type ReasonKind, TOPICS } from "../src/server/ports";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

// Whether a service URL names this machine. Only the name is checked: a remote service
// tunnelled to localhost passes.
export function localOnly(
  name: "DATABASE_URL" | "VALKEY_URL",
  raw: string,
): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: `${name} isn't a URL` };
  }
  if (!LOCAL_HOSTS.includes(parsed.hostname))
    return {
      ok: false,
      reason: `${name} host ${parsed.hostname || "(none)"} isn't local`,
    };
  // libpq honours a host in the query over the authority: refuse one, so the check holds.
  for (const param of ["host", "hostaddr"])
    if (parsed.searchParams.has(param))
      return { ok: false, reason: `${name} sets ${param}= in its query` };
  return { ok: true };
}

const MODEL = "demo-seed";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);
const utcDay = (daysAgo: number) =>
  new Date(now - daysAgo * DAY).toISOString().slice(0, 10);

// The walkthrough's test players (~/walk/seed.sh makes them); a and b get onboarded.
const PLAYERS = ["walk-a", "walk-b", "walk-c", "walk-d"] as const;
type Player = (typeof PLAYERS)[number];
const ONBOARDING: Partial<
  Record<
    Player,
    {
      topics: Topic[];
      level: Difficulty;
      breakLength: BreakLength;
      goals: LearningGoal[];
    }
  >
> = {
  "walk-a": {
    topics: ["system-design", "databases", "distributed-systems", "backend"],
    level: "intermediate",
    breakLength: "3-8",
    goals: ["system-design-interviews", "stay-sharp"],
  },
  "walk-b": {
    topics: ["databases", "backend"],
    level: "advanced",
    breakLength: "3-8",
    goals: ["stack-i-use"],
  },
};

const CONCEPTS: { slug: string; name: string; topic: Topic }[] = [
  {
    slug: "demo-consistent-hashing",
    name: "Consistent hashing",
    topic: "system-design",
  },
  {
    slug: "demo-load-balancing",
    name: "Load balancing",
    topic: "system-design",
  },
  { slug: "demo-caching", name: "Caching strategies", topic: "system-design" },
  { slug: "demo-b-tree-indexes", name: "B-tree indexes", topic: "databases" },
  { slug: "demo-mvcc", name: "MVCC", topic: "databases" },
  {
    slug: "demo-write-ahead-log",
    name: "Write-ahead logging",
    topic: "databases",
  },
  {
    slug: "demo-raft",
    name: "Raft consensus",
    topic: "distributed-systems",
  },
  {
    slug: "demo-vector-clocks",
    name: "Vector clocks",
    topic: "distributed-systems",
  },
  { slug: "demo-idempotency-keys", name: "Idempotency keys", topic: "backend" },
  { slug: "demo-rate-limiting", name: "Rate limiting", topic: "backend" },
  {
    slug: "demo-connection-pooling",
    name: "Connection pooling",
    topic: "backend",
  },
];

// Moments need a full-text profile with moments on (the moment_rights trigger); the
// excerpt source is the most a non-full-text source allows, and gives article cards.
const SOURCES = [
  {
    key: "systems",
    name: "Demo · Systems Notebook",
    topics: ["system-design", "distributed-systems"],
    rights: "full_text_internal",
    quality: 5,
  },
  {
    key: "storage",
    name: "Demo · Storage Internals",
    topics: ["databases"],
    rights: "full_text_internal",
    quality: 4,
  },
  {
    key: "backend",
    name: "Demo · Backend Field Notes",
    topics: ["backend"],
    rights: "full_text_internal",
    quality: 4,
  },
  {
    key: "digest",
    name: "Demo · Distributed Digest",
    topics: ["distributed-systems", "backend"],
    rights: "excerpt",
    quality: 3,
  },
] as const;
type SourceKey = (typeof SOURCES)[number]["key"];

type Section = { heading: string; minutes: number; concept: string };
type Item = {
  key: string;
  source: SourceKey;
  title: string;
  author: string;
  daysAgo: number;
  difficulty: Difficulty;
  sections: Section[];
  excerpt?: string;
};

const ITEMS: Item[] = [
  {
    key: "hash-ring",
    source: "systems",
    title: "Designing a Consistent Hashing Ring That Survives Node Churn",
    author: "Priya Raman",
    daysAgo: 3,
    difficulty: "intermediate",
    sections: [
      {
        heading: "Why modulo hashing breaks",
        minutes: 3,
        concept: "demo-consistent-hashing",
      },
      {
        heading: "Virtual nodes",
        minutes: 5,
        concept: "demo-consistent-hashing",
      },
      {
        heading: "Rebalancing without a stampede",
        minutes: 6,
        concept: "demo-load-balancing",
      },
      {
        heading: "Measuring load skew",
        minutes: 2,
        concept: "demo-load-balancing",
      },
    ],
  },
  {
    key: "cache-invalidation",
    source: "systems",
    title: "Cache Invalidation Patterns at Scale",
    author: "Marcus Lee",
    daysAgo: 6,
    difficulty: "intermediate",
    sections: [
      {
        heading: "Write-through or write-behind",
        minutes: 4,
        concept: "demo-caching",
      },
      { heading: "TTL jitter", minutes: 2, concept: "demo-caching" },
      { heading: "Stampede protection", minutes: 5, concept: "demo-caching" },
    ],
  },
  {
    key: "raft-election",
    source: "systems",
    title: "How Raft Elects a Leader, Step by Step",
    author: "Elena Petrova",
    daysAgo: 9,
    difficulty: "advanced",
    sections: [
      { heading: "Terms and votes", minutes: 3, concept: "demo-raft" },
      {
        heading: "Randomised election timeouts",
        minutes: 2,
        concept: "demo-raft",
      },
      { heading: "Log matching", minutes: 6, concept: "demo-raft" },
      { heading: "Safety under partitions", minutes: 9, concept: "demo-raft" },
    ],
  },
  {
    key: "l4-l7",
    source: "systems",
    title: "Load Balancers: L4 vs L7 in Practice",
    author: "Daniel Okafor",
    daysAgo: 12,
    difficulty: "beginner",
    sections: [
      {
        heading: "Connection or request balancing",
        minutes: 4,
        concept: "demo-load-balancing",
      },
      {
        heading: "Health checks that don't lie",
        minutes: 3,
        concept: "demo-load-balancing",
      },
      {
        heading: "Least outstanding requests",
        minutes: 2,
        concept: "demo-load-balancing",
      },
    ],
  },
  {
    key: "b-tree",
    source: "storage",
    title: "Inside a B-tree: Pages, Splits and Fill Factor",
    author: "Hannah Schmidt",
    daysAgo: 2,
    difficulty: "intermediate",
    sections: [
      { heading: "Page layout", minutes: 5, concept: "demo-b-tree-indexes" },
      {
        heading: "Splits and merges",
        minutes: 7,
        concept: "demo-b-tree-indexes",
      },
      { heading: "Fill factor", minutes: 2, concept: "demo-b-tree-indexes" },
    ],
  },
  {
    key: "mvcc",
    source: "storage",
    title: "MVCC Without the Mystery",
    author: "Tomás Alvarez",
    daysAgo: 5,
    difficulty: "advanced",
    sections: [
      {
        heading: "Snapshots and visibility",
        minutes: 6,
        concept: "demo-mvcc",
      },
      { heading: "Vacuum and bloat", minutes: 10, concept: "demo-mvcc" },
      { heading: "Write skew", minutes: 4, concept: "demo-mvcc" },
    ],
  },
  {
    key: "wal",
    source: "storage",
    title: "Write-Ahead Logging and Crash Recovery",
    author: "Aiko Tanaka",
    daysAgo: 8,
    difficulty: "intermediate",
    sections: [
      { heading: "Why log first", minutes: 2, concept: "demo-write-ahead-log" },
      { heading: "Checkpoints", minutes: 5, concept: "demo-write-ahead-log" },
      {
        heading: "Replaying after a crash",
        minutes: 8,
        concept: "demo-write-ahead-log",
      },
    ],
  },
  {
    key: "idempotency",
    source: "backend",
    title: "Idempotency Keys for Payment APIs",
    author: "Sam Whitfield",
    daysAgo: 1,
    difficulty: "intermediate",
    sections: [
      {
        heading: "The double-charge problem",
        minutes: 3,
        concept: "demo-idempotency-keys",
      },
      {
        heading: "Storing keys with responses",
        minutes: 6,
        concept: "demo-idempotency-keys",
      },
      {
        heading: "Expiry and replays",
        minutes: 4,
        concept: "demo-idempotency-keys",
      },
    ],
  },
  {
    key: "token-bucket",
    source: "backend",
    title: "Rate Limiting with Token Buckets in Redis",
    author: "Nadia Hussain",
    daysAgo: 4,
    difficulty: "intermediate",
    sections: [
      {
        heading: "Token bucket or sliding window",
        minutes: 5,
        concept: "demo-rate-limiting",
      },
      {
        heading: "Atomic refills with Lua",
        minutes: 9,
        concept: "demo-rate-limiting",
      },
      {
        heading: "Limits per tenant",
        minutes: 3,
        concept: "demo-rate-limiting",
      },
    ],
  },
  {
    key: "pool-sizing",
    source: "backend",
    title: "Sizing a Database Connection Pool",
    author: "Chris Mendel",
    daysAgo: 10,
    difficulty: "beginner",
    sections: [
      {
        heading: "Little's law for pools",
        minutes: 4,
        concept: "demo-connection-pooling",
      },
      {
        heading: "Timeouts and queueing",
        minutes: 12,
        concept: "demo-connection-pooling",
      },
    ],
  },
  {
    key: "vector-clocks",
    source: "digest",
    title: "Vector Clocks Explained with Shopping Carts",
    author: "Lina Berg",
    daysAgo: 2,
    difficulty: "beginner",
    sections: [],
    excerpt:
      "Two replicas accept writes to the same cart while partitioned. Vector clocks tell you whether one write happened before the other, or whether you have a real conflict to merge.",
  },
  {
    key: "exactly-once",
    source: "digest",
    title: "What Exactly-Once Delivery Really Means",
    author: "Ravi Kumar",
    daysAgo: 7,
    difficulty: "advanced",
    sections: [],
    excerpt:
      "Brokers can't promise a message arrives exactly once, but a pipeline can make its effects happen once: deduplicate on a key and make every side effect idempotent.",
  },
  {
    key: "backpressure",
    source: "digest",
    title: "Backpressure in Streaming Services",
    author: "Jo Park",
    daysAgo: 11,
    difficulty: "intermediate",
    sections: [],
    excerpt:
      "When a consumer falls behind, buffering only hides the problem. Bounded queues, credit-based flow control and load shedding each push the slowdown back to where it can be handled.",
  },
];

// Multiple-choice questions on sections, as live; the first options are not always right.
const QUESTIONS: {
  item: string;
  section: number;
  concept: string;
  stem: string;
  options: [string, string, string, string];
  correct: number;
  difficulty: Difficulty;
}[] = [
  {
    item: "hash-ring",
    section: 0,
    concept: "demo-consistent-hashing",
    stem: "With hash(key) mod N placement, roughly what share of keys move when one node is added to a 10-node cluster?",
    options: ["About 10%", "About 50%", "About 90%", "None"],
    correct: 2,
    difficulty: "intermediate",
  },
  {
    item: "hash-ring",
    section: 1,
    concept: "demo-consistent-hashing",
    stem: "What do virtual nodes mainly fix on a consistent hashing ring?",
    options: [
      "Uneven load from few physical nodes",
      "Slow hash functions",
      "Clock skew between nodes",
      "Lost writes during failover",
    ],
    correct: 0,
    difficulty: "intermediate",
  },
  {
    item: "l4-l7",
    section: 0,
    concept: "demo-load-balancing",
    stem: "Which load balancer can route a request by its URL path?",
    options: ["An L4 balancer", "An L7 balancer", "DNS round robin", "ECMP"],
    correct: 1,
    difficulty: "beginner",
  },
  {
    item: "cache-invalidation",
    section: 1,
    concept: "demo-caching",
    stem: "Why add random jitter to cache TTLs?",
    options: [
      "To save memory",
      "So keys written together don't all expire at once",
      "To make reads consistent",
      "To avoid hash collisions",
    ],
    correct: 1,
    difficulty: "intermediate",
  },
  {
    item: "b-tree",
    section: 1,
    concept: "demo-b-tree-indexes",
    stem: "What happens when an insert lands on a full B-tree leaf page?",
    options: [
      "The insert is rejected",
      "The page splits and a key moves up to the parent",
      "The whole tree is rebuilt",
      "The row goes to an overflow log",
    ],
    correct: 1,
    difficulty: "intermediate",
  },
  {
    item: "mvcc",
    section: 0,
    concept: "demo-mvcc",
    stem: "Under MVCC, what does a reader see while a writer updates a row?",
    options: [
      "It waits for the writer's lock",
      "The uncommitted new version",
      "The last version committed before its snapshot",
      "An error",
    ],
    correct: 2,
    difficulty: "advanced",
  },
  {
    item: "wal",
    section: 0,
    concept: "demo-write-ahead-log",
    stem: "Why must the log record reach disk before the changed data page?",
    options: [
      "So recovery can redo or undo the change after a crash",
      "Because the log is smaller",
      "To compress the page",
      "So replicas read it first",
    ],
    correct: 0,
    difficulty: "intermediate",
  },
  {
    item: "raft-election",
    section: 1,
    concept: "demo-raft",
    stem: "Why does Raft randomise election timeouts?",
    options: [
      "To spread CPU load",
      "So split votes are unlikely to repeat",
      "To hide the leader from clients",
      "To shorten log entries",
    ],
    correct: 1,
    difficulty: "advanced",
  },
  {
    item: "idempotency",
    section: 1,
    concept: "demo-idempotency-keys",
    stem: "A retried payment request carries a key the server has already completed. What should it return?",
    options: [
      "A new charge",
      "409 Conflict, always",
      "The stored response of the first request",
      "Nothing",
    ],
    correct: 2,
    difficulty: "intermediate",
  },
  {
    item: "token-bucket",
    section: 0,
    concept: "demo-rate-limiting",
    stem: "What does a token bucket allow that a fixed window does not?",
    options: [
      "Short bursts up to the bucket size",
      "Unlimited requests",
      "Per-user encryption",
      "Exactly even spacing of requests",
    ],
    correct: 0,
    difficulty: "intermediate",
  },
];

const CHIPS: { chip: BreakLength; min: number; max: number }[] = [
  { chip: "1-3", min: 1, max: 3 },
  { chip: "3-8", min: 4, max: 8 },
  { chip: "8-15", min: 9, max: 15 },
];
const FEED_PER_CHIP = 8;

const linkOf = (item: Item) =>
  `https://example.com/demo/${item.source}/${item.key}`;
const anchorOf = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const WORDS_PER_MINUTE = 230; // as item_minutes counts

async function seed(db: Kysely<DB>): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const count = (what: string, n = 1) => {
    counts[what] = (counts[what] ?? 0) + n;
  };

  const users = await db
    .selectFrom("app_user")
    .select("id")
    .where("id", "in", [...PLAYERS])
    .execute();
  const present = new Set(users.map((u) => u.id));
  const missing = PLAYERS.filter((p) => !present.has(p));
  if (missing.length > 0)
    throw new Error(
      `missing test users ${missing.join(", ")}: run ~/walk/seed.sh (or sign them up) first`,
    );

  for (const [user, choice] of Object.entries(ONBOARDING)) {
    // An existing onboarding is the user's own choice and stays (PER-1).
    await db
      .insertInto("user_preferences")
      .values({
        user_id: user,
        topics: choice.topics,
        level: choice.level,
        break_length: choice.breakLength,
        goals: choice.goals,
        onboarded_at: ago(14 * DAY),
      })
      .onConflict((oc) => oc.column("user_id").doNothing())
      .execute();
    count("user_preferences");
  }
  // What each onboarded user actually chose, kept or just written: their feed is built
  // from it, not from ONBOARDING. node-pg doesn't parse arrays of an enum it doesn't
  // know: read them as text[] (as kysely-preferences does), goals in the user's order.
  const preferences = (
    await db
      .selectFrom("user_preferences")
      .select([
        "user_id",
        sql<string[]>`topics::text[]`.as("topics"),
        sql<string[]>`goals::text[]`.as("goals"),
        "level",
      ])
      .where("user_id", "in", Object.keys(ONBOARDING))
      .orderBy("user_id")
      .execute()
  ).map((p) => ({
    ...p,
    topics: TOPICS.filter((t) => p.topics.includes(t)),
    goals: p.goals.flatMap((g) => GOALS.find((x) => x === g) ?? []),
  }));
  for (const user of PLAYERS) {
    await db
      .insertInto("player_username")
      .values({ user_id: user, username: user.replace("-", "er_") })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  const conceptId = new Map<string, string>();
  for (const c of CONCEPTS) {
    const row = await db
      .insertInto("concept")
      .values({ slug: c.slug, name: c.name, topic: c.topic })
      .onConflict((oc) =>
        oc
          .column("slug")
          .doUpdateSet({ name: c.name, topic: c.topic, retired_at: null }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();
    conceptId.set(c.slug, row.id);
    count("concept");
  }
  const concept = (slug: string) => {
    const id = conceptId.get(slug);
    if (id === undefined) throw new Error(`no demo concept ${slug}`);
    return id;
  };

  const sourceId = new Map<SourceKey, string>();
  for (const s of SOURCES) {
    const moments = s.rights === "full_text_internal";
    const values = {
      name: s.name,
      homepage: `https://example.com/demo/${s.key}`,
      feed_url: `https://example.com/demo/${s.key}/feed.xml`,
      rights_profile: s.rights,
      moments_seeded: moments,
      moments_enabled: moments,
      topics: [...s.topics],
      quality_score: s.quality,
      // Never polled: example.com has no feed, and the worker shouldn't try.
      active: false,
    };
    const row = await db
      .insertInto("source")
      .values(values)
      .onConflict((oc) => oc.column("name").doUpdateSet(values))
      .returning("id")
      .executeTakeFirstOrThrow();
    sourceId.set(s.key, row.id);
    count("source");
  }

  type Moment = {
    id: string;
    item: Item;
    itemId: string;
    ordinal: number;
    minutes: number;
  };
  const itemId = new Map<string, string>();
  const moments: Moment[] = [];
  for (const item of ITEMS) {
    const source = sourceId.get(item.source);
    if (source === undefined) throw new Error(`no source ${item.source}`);
    const values = {
      source_id: source,
      guid: `demo-${item.key}`,
      canonical_url: linkOf(item),
      title: item.title,
      author: item.author,
      published_at: ago(item.daysAgo * DAY),
      excerpt: item.excerpt ?? null,
      frameable: false,
    };
    const row = await db
      .insertInto("content_item")
      .values(values)
      .onConflict((oc) => oc.columns(["source_id", "guid"]).doUpdateSet(values))
      .returning("id")
      .executeTakeFirstOrThrow();
    itemId.set(item.key, row.id);
    count("content_item");
    for (const [ordinal, s] of item.sections.entries()) {
      const anchor = anchorOf(s.heading);
      const section = {
        content_item_id: row.id,
        ordinal,
        heading: s.heading,
        level: 2,
        anchor_id: anchor,
        word_count: s.minutes * WORDS_PER_MINUTE,
      };
      await db
        .insertInto("content_item_section")
        .values(section)
        .onConflict((oc) =>
          oc.columns(["content_item_id", "ordinal"]).doUpdateSet(section),
        )
        .execute();
      const moment = {
        content_item_id: row.id,
        ordinal,
        title: s.heading,
        estimated_minutes: s.minutes,
        link: `${linkOf(item)}#${anchor}`,
        link_type: "anchor" as const,
      };
      const m = await db
        .insertInto("moment")
        .values(moment)
        .onConflict((oc) =>
          oc.columns(["content_item_id", "ordinal"]).doUpdateSet(moment),
        )
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .insertInto("moment_tagging")
        .values({ moment_id: m.id, difficulty: item.difficulty })
        .onConflict((oc) =>
          oc.column("moment_id").doUpdateSet({ difficulty: item.difficulty }),
        )
        .execute();
      await db
        .insertInto("moment_concept")
        .values({ moment_id: m.id, concept_id: concept(s.concept) })
        .onConflict((oc) => oc.doNothing())
        .execute();
      moments.push({
        id: m.id,
        item,
        itemId: row.id,
        ordinal,
        minutes: s.minutes,
      });
      count("moment");
    }
  }
  const item = (key: string) => {
    const id = itemId.get(key);
    if (id === undefined) throw new Error(`no demo item ${key}`);
    return id;
  };
  const momentOf = (key: string, ordinal: number) => {
    const m = moments.find((x) => x.item.key === key && x.ordinal === ordinal);
    if (m === undefined)
      throw new Error(`no demo moment ${key}/${String(ordinal)}`);
    return m.id;
  };

  const questionIds: string[] = [];
  for (const [n, q] of QUESTIONS.entries()) {
    const values = {
      moment_id: momentOf(q.item, q.section),
      ordinal: 0,
      kind: "choice" as const,
      stem: q.stem,
      options: q.options,
      correct: q.correct,
      citation: `${ITEMS.find((i) => i.key === q.item)?.title ?? ""}, “${
        ITEMS.find((i) => i.key === q.item)?.sections[q.section]?.heading ?? ""
      }”`.slice(0, 300),
      status: "live" as const,
      generator_model: MODEL,
      prompt_version: 1,
      content_hash: `demo-question-${String(n)}`,
      difficulty: q.difficulty,
    };
    const row = await db
      .insertInto("question")
      .values(values)
      .onConflict((oc) =>
        oc
          .columns(["moment_id", "kind", "ordinal"])
          .where("status", "<>", "retired")
          .doUpdateSet(values),
      )
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("question_concept")
      .values({ question_id: row.id, concept_id: concept(q.concept) })
      .onConflict((oc) => oc.doNothing())
      .execute();
    questionIds.push(row.id);
    count("question");
  }

  // Paths: one walker a is part-way through, one to start.
  const pathSeeds = [
    {
      name: "Scaling reads and writes",
      why: "From spreading keys across nodes to keeping caches honest and agreeing on a leader: the moves behind most system design answers.",
      sections: [
        {
          concepts: ["demo-consistent-hashing", "demo-load-balancing"],
          sessions: [
            ["hash-ring", 0],
            ["l4-l7", 0],
          ],
        },
        {
          concepts: ["demo-caching"],
          sessions: [
            ["cache-invalidation", 0],
            ["cache-invalidation", 2],
          ],
        },
        {
          concepts: ["demo-raft"],
          sessions: [
            ["raft-election", 0],
            ["raft-election", 1],
          ],
        },
      ],
    },
    {
      name: "Database internals",
      why: "How a database stores, versions and recovers your rows: B-trees, MVCC and the write-ahead log.",
      sections: [
        {
          concepts: ["demo-b-tree-indexes"],
          sessions: [
            ["b-tree", 0],
            ["b-tree", 1],
          ],
        },
        {
          concepts: ["demo-mvcc"],
          sessions: [
            ["mvcc", 0],
            ["mvcc", 2],
          ],
        },
        {
          concepts: ["demo-write-ahead-log"],
          sessions: [
            ["wal", 0],
            ["wal", 1],
          ],
        },
      ],
    },
  ] as const;
  const pathIds: string[] = [];
  const firstSections: string[] = [];
  for (const p of pathSeeds) {
    const found = await db
      .selectFrom("path")
      .select("id")
      .where("name", "=", p.name)
      .where("model", "=", MODEL)
      .executeTakeFirst();
    const path =
      found ??
      (await db
        .insertInto("path")
        .values({
          name: p.name,
          why: p.why,
          status: "live",
          model: MODEL,
          prompt_version: 1,
          decided_at: ago(20 * DAY),
        })
        .returning("id")
        .executeTakeFirstOrThrow());
    pathIds.push(path.id);
    count("path");
    for (const [ordinal, s] of p.sections.entries()) {
      const section = await db
        .insertInto("path_section")
        .values({ path_id: path.id, ordinal })
        .onConflict((oc) =>
          oc.columns(["path_id", "ordinal"]).doUpdateSet({ ordinal }),
        )
        .returning("id")
        .executeTakeFirstOrThrow();
      if (ordinal === 0) firstSections.push(section.id);
      for (const slug of s.concepts)
        await db
          .insertInto("path_section_concept")
          .values({ section_id: section.id, concept_id: concept(slug) })
          .onConflict((oc) => oc.doNothing())
          .execute();
      for (const [n, [key, m]] of s.sessions.entries()) {
        const moment_id = momentOf(key, m);
        await db
          .insertInto("path_session")
          .values({ section_id: section.id, ordinal: n, moment_id })
          .onConflict((oc) =>
            oc.columns(["section_id", "ordinal"]).doUpdateSet({ moment_id }),
          )
          .execute();
      }
    }
  }

  // Walker a's reading: the hash ring part-read (Continue reading), the path's first
  // section read and its checkpoint passed, and one reading into the second.
  const a = "walk-a";
  const finished: [string, number, number][] = [
    ["hash-ring", 0, 2 * DAY],
    ["l4-l7", 0, 2 * DAY - HOUR],
    ["cache-invalidation", 0, DAY],
    ["b-tree", 0, 5 * DAY],
    ["wal", 0, 4 * DAY],
  ];
  for (const [key, m, when] of finished) {
    await db
      .insertInto("user_moment_finished")
      .values({
        user_id: a,
        moment_id: momentOf(key, m),
        method: "mark_done",
        finished_at: ago(when),
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    count("user_moment_finished");
  }
  await db
    .insertInto("user_moment_opened")
    .values({
      user_id: a,
      moment_id: momentOf("hash-ring", 1),
      opened_at: ago(HOUR),
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  await db
    .insertInto("user_article_finished")
    .values({
      user_id: a,
      content_item_id: item("exactly-once"),
      method: "mark_done",
      finished_at: ago(3 * DAY),
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  for (const [key, when] of [
    ["mvcc", 6 * HOUR],
    ["token-bucket", DAY],
    ["vector-clocks", 2 * DAY],
  ] as const) {
    await db
      .insertInto("user_save")
      .values({ user_id: a, content_item_id: item(key), saved_at: ago(when) })
      .onConflict((oc) => oc.doNothing())
      .execute();
    count("user_save");
  }
  const notes: [string, number | null, string][] = [
    [
      "hash-ring",
      0,
      "Adding one node to mod-N moves almost every key. The ring moves only its neighbour's share.",
    ],
    [
      "b-tree",
      0,
      "Leaf pages hold keys plus row pointers; inner pages only keys. That's why fan-out is so high.",
    ],
    [
      "vector-clocks",
      null,
      "Concurrent writes = neither clock dominates. Ask: who merges, client or server?",
    ],
  ];
  for (const [key, m, body] of notes) {
    const content_item_id = item(key);
    const moment_id = m === null ? null : momentOf(key, m);
    const exists = await db
      .selectFrom("user_note")
      .select("id")
      .where("user_id", "=", a)
      .where("content_item_id", "=", content_item_id)
      .where("moment_id", moment_id === null ? "is" : "=", moment_id)
      .executeTakeFirst();
    if (exists === undefined)
      await db
        .insertInto("user_note")
        .values({
          user_id: a,
          content_item_id,
          moment_id,
          section_title:
            m === null
              ? null
              : (ITEMS.find((i) => i.key === key)?.sections[m]?.heading ??
                null),
          body,
        })
        .execute();
    count("user_note");
  }

  const [scaling] = pathIds;
  const [firstSection] = firstSections;
  if (scaling === undefined || firstSection === undefined)
    throw new Error("demo path missing");
  const active = await db
    .selectFrom("user_path")
    .select("path_id")
    .where("user_id", "=", a)
    .where("status", "=", "active")
    .executeTakeFirst();
  // One active path per user: another one already active stays so, and this is paused.
  await db
    .insertInto("user_path")
    .values({
      user_id: a,
      path_id: scaling,
      status:
        active === undefined || active.path_id === scaling
          ? "active"
          : "paused",
      started_at: ago(6 * DAY),
    })
    .onConflict((oc) => oc.columns(["user_id", "path_id"]).doNothing())
    .execute();
  const passed = await db
    .selectFrom("quiz_attempt")
    .select("id")
    .where("user_id", "=", a)
    .where("path_section_id", "=", firstSection)
    .where("checkpoint_passed", "=", true)
    .executeTakeFirst();
  if (passed === undefined)
    await db
      .insertInto("quiz_attempt")
      .values({
        user_id: a,
        path_section_id: firstSection,
        checkpoint_size: 2,
        started_at: ago(2 * DAY),
        ends_at: ago(2 * DAY - 5 * 60_000),
        finished_at: ago(2 * DAY - 3 * 60_000),
        checkpoint_passed: true,
      })
      .execute();

  // What walker a has learned: three cards due today, the rest later (FSRS fields as
  // ts-fsrs keeps them: state 2 is Review).
  const mastery: [string, LearnerState, number, number | null][] = [
    ["demo-consistent-hashing", "due_for_review", 0.62, -DAY],
    ["demo-load-balancing", "practiced", 0.55, -2 * HOUR],
    ["demo-b-tree-indexes", "due_for_review", 0.58, -3 * HOUR],
    ["demo-caching", "explored", 0.35, 3 * DAY],
    ["demo-write-ahead-log", "mastered", 0.9, 9 * DAY],
    ["demo-idempotency-keys", "practiced", 0.6, 4 * DAY],
  ];
  for (const [slug, state, probability, dueIn] of mastery) {
    const concept_id = concept(slug);
    await db
      .insertInto("concept_mastery")
      .values({
        user_id: a,
        concept_id,
        probability,
        state,
        evidence_count: 3,
        updated_at: ago(DAY),
      })
      .onConflict((oc) => oc.columns(["user_id", "concept_id"]).doNothing())
      .execute();
    if (dueIn !== null)
      await db
        .insertInto("concept_review")
        .values({
          user_id: a,
          concept_id,
          due: new Date(now + dueIn),
          stability: 3.2,
          difficulty: 5.1,
          scheduled_days: 3,
          learning_steps: 0,
          reps: 2,
          lapses: 0,
          state: 2,
          last_review: ago(4 * DAY),
        })
        .onConflict((oc) => oc.columns(["user_id", "concept_id"]).doNothing())
        .execute();
    count("concept_mastery");
  }

  // The daily challenge: today's still to play for walker a, who played the four days
  // before it (a streak of 4); the others played some days, today included.
  const daily = questionIds.slice(0, 5);
  for (let d = 0; d <= 4; d += 1) {
    const day = utcDay(d);
    await db
      .insertInto("daily_challenge")
      .values({
        day,
        picked_at: ago((d + 1) * DAY),
        approved_at: ago((d + 1) * DAY),
      })
      .onConflict((oc) => oc.column("day").doNothing())
      .execute();
    for (const [position, question_id] of daily.entries())
      await db
        .insertInto("daily_challenge_question")
        .values({ day, position, question_id })
        .onConflict((oc) => oc.doNothing())
        .execute();
  }
  count("daily_challenge", 5);
  const dailyPlays: [Player, number, number][] = [
    ["walk-a", 1, 410],
    ["walk-a", 2, 380],
    ["walk-a", 3, 450],
    ["walk-a", 4, 300],
    ["walk-b", 0, 470],
    ["walk-b", 1, 350],
    ["walk-b", 2, 390],
    ["walk-c", 0, 420],
    ["walk-c", 1, 440],
    ["walk-d", 0, 260],
  ];
  for (const [user, d, score] of dailyPlays) {
    const day = utcDay(d);
    // Today's play started a few minutes ago; earlier days' at noon.
    const start = d === 0 ? ago(10 * 60_000) : new Date(`${day}T12:00:00Z`);
    const row = await db
      .insertInto("quiz_attempt")
      .values({
        user_id: user,
        daily_day: day,
        started_at: start,
        ends_at: new Date(start.getTime() + 120_000),
        finished_at: new Date(start.getTime() + 95_000),
      })
      .onConflict((oc) =>
        oc
          .columns(["user_id", "daily_day"])
          .where("daily_day", "is not", null)
          .doUpdateSet({ user_id: user }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();
    await boardScore(db, row.id, score);
    count("daily_play");
  }

  // Sprints this ISO week, one each.
  const sprints: [Player, number][] = [
    ["walk-a", 640],
    ["walk-b", 720],
    ["walk-c", 510],
    ["walk-d", 580],
  ];
  for (const [user, score] of sprints) {
    const found = await db
      .selectFrom("quiz_attempt")
      .select("id")
      .where("user_id", "=", user)
      .where("sprint", "=", true)
      .where(
        sql<boolean>`date_trunc('week', started_at at time zone 'utc')
          = date_trunc('week', now() at time zone 'utc')`,
      )
      .executeTakeFirst();
    const row =
      found ??
      (await db
        .insertInto("quiz_attempt")
        .values({
          user_id: user,
          sprint: true,
          started_at: ago(20 * 60_000),
          ends_at: ago(19 * 60_000),
          finished_at: ago(19 * 60_000),
        })
        .returning("id")
        .executeTakeFirstOrThrow());
    await boardScore(db, row.id, score);
    count("sprint");
  }

  // Live 1v1 quick games, rated (MATCH-2): Play's rating and this month's season board.
  const matches: {
    id: string;
    winner: Player;
    players: [Player, number, number][];
  }[] = [
    {
      id: "00000000-de70-4000-8000-000000000001",
      winner: "walk-a",
      players: [
        ["walk-a", 1500, 1532],
        ["walk-b", 1500, 1468],
      ],
    },
    {
      id: "00000000-de70-4000-8000-000000000002",
      winner: "walk-c",
      players: [
        ["walk-c", 1580, 1611],
        ["walk-d", 1430, 1399],
      ],
    },
  ];
  for (const m of matches) {
    await db
      .insertInto("game_match")
      .values({
        id: m.id,
        server_id: 0,
        mode: "sprint",
        created_at: ago(2 * HOUR),
        finished_at: ago(HOUR),
        outcome: "finished",
        winner_id: m.winner,
        rated_at: ago(HOUR),
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    for (const [user, before, after] of m.players) {
      await db
        .insertInto("game_match_player")
        .values({
          match_id: m.id,
          user_id: user,
          total: user === m.winner ? 5 : 3,
          time_ms: 54_000,
          abandoned: false,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto("player_rating")
        .values({
          user_id: user,
          rating: after,
          rd: 180,
          volatility: 0.06,
          games: 1,
        })
        .onConflict((oc) => oc.column("user_id").doNothing())
        .execute();
      await db
        .insertInto("rating_history")
        .values({
          user_id: user,
          match_id: m.id,
          rating_before: before,
          rating_after: after,
          rd_after: 180,
          volatility_after: 0.06,
          score: user === m.winner ? 1 : 0,
          at: ago(HOUR),
        })
        .onConflict((oc) => oc.columns(["user_id", "match_id"]).doNothing())
        .execute();
      count("rated_player");
    }
  }

  // The stored feed (CACHE-1) for the onboarded players, built from their stored
  // choices (PER-1) as the worker writes it: each chip's cards by length on the user's
  // topics, nearest their level first, the sources taking turns, ranked from 1, every
  // chip stored whatever the break length (it only picks the chip Home opens on). Each
  // card states one reason that holds of that user, in the first-that-holds order of
  // ADR-0027 with wording from workers/jobs/seeds/reasons.yaml.
  const conceptOf = (slug: string) => {
    const c = CONCEPTS.find((x) => x.slug === slug);
    if (c === undefined) throw new Error(`no demo concept ${slug}`);
    return c;
  };
  const sourceOf = (i: Item) => {
    const s = SOURCES.find((x) => x.key === i.source);
    if (s === undefined) throw new Error(`no demo source ${i.source}`);
    return s;
  };
  // A moment's concept, or a whole article's: its sections' (none on an excerpt).
  const conceptsOf = (i: Item, ordinal: number | null) =>
    (ordinal === null ? i.sections : i.sections.slice(ordinal, ordinal + 1))
      .map((s) => conceptOf(s.concept))
      .sort((x, y) => x.slug.localeCompare(y.slug));
  const topicsOf = (i: Item, ordinal: number | null): readonly Topic[] =>
    i.sections.length === 0
      ? sourceOf(i).topics
      : conceptsOf(i, ordinal).map((c) => c.topic);
  const LEVELS: Difficulty[] = ["beginner", "intermediate", "advanced"];
  const GOAL_REASON: Partial<
    Record<LearningGoal, (concept: string) => string>
  > = {
    "system-design-interviews": (c) =>
      `Good prep for system design interviews: ${c}.`,
    "stack-i-use": (c) => `Part of the stack you use: ${c}.`,
  };
  // The concept slugs each of the user's goals points at, as user_goal_concepts reads
  // them: the curated set, and for the stack goal their projects' technologies.
  const goalConcepts = async (user: string, goals: LearningGoal[]) => {
    const sets = new Map<LearningGoal, Set<string>>();
    if (goals.length === 0) return sets;
    const curated = await db
      .selectFrom("goal_concept")
      .select(["goal", "concept_slug"])
      .where("goal", "in", goals)
      .execute();
    for (const row of curated)
      sets.set(
        row.goal,
        (sets.get(row.goal) ?? new Set()).add(row.concept_slug),
      );
    if (goals.includes("stack-i-use")) {
      const stack = await sql<{ slug: string }>`
        select c.slug from user_technology_concepts(${user}) u
        join concept c on c.id = u.concept_id
      `.execute(db);
      sets.set("stack-i-use", new Set(stack.rows.map((r) => r.slug)));
    }
    return sets;
  };
  const itemMinutes = (i: Item) =>
    i.sections.reduce((t, s) => t + s.minutes, 0);
  for (const prefs of preferences) {
    const user = prefs.user_id;
    const goalSets = await goalConcepts(user, prefs.goals);
    const reasonFor = (
      i: Item,
      ordinal: number | null,
    ): { text: string; kind: ReasonKind | null } => {
      // A demo concept stands in for the curated concept of its name less "demo-".
      for (const goal of prefs.goals) {
        const line = GOAL_REASON[goal];
        const set = goalSets.get(goal);
        const hit = conceptsOf(i, ordinal).find((c) =>
          set?.has(c.slug.replace(/^demo-/, "")),
        );
        if (line !== undefined && hit !== undefined)
          return { text: line(hit.name), kind: "goal_match" };
      }
      const source = sourceOf(i);
      if (i.daysAgo <= 7)
        return {
          text: `New this week from ${source.name}.`,
          kind: "freshness",
        };
      if (source.quality >= 4)
        return {
          text: `From ${source.name}, one of the best-rated sources here.`,
          kind: "quality",
        };
      return { text: "Worth exploring.", kind: null };
    };
    const onTopic = (i: Item, ordinal: number | null) =>
      topicsOf(i, ordinal).some((t) => prefs.topics.includes(t));
    const levelGap = (d: Difficulty) =>
      Math.abs(LEVELS.indexOf(d) - LEVELS.indexOf(prefs.level));
    for (const { chip, min, max } of CHIPS) {
      const pool = [
        ...moments
          .filter(
            (m) =>
              m.minutes >= min &&
              m.minutes <= max &&
              onTopic(m.item, m.ordinal),
          )
          .map((m) => ({
            item: m.item,
            itemId: m.itemId,
            momentId: m.id,
            ordinal: m.ordinal,
          })),
        // Whole articles: the full-text ones that fit the chip, and every excerpt one.
        ...ITEMS.filter((i) => {
          const minutes = itemMinutes(i);
          return (
            onTopic(i, null) &&
            (i.sections.length === 0
              ? chip !== "1-3"
              : minutes >= min && minutes <= max)
          );
        }).map((i) => ({
          item: i,
          itemId: item(i.key),
          momentId: null,
          ordinal: null,
        })),
      ];
      // The sources take turns, so a chip doesn't open on one publisher's run.
      const bySource = SOURCES.map((s) =>
        pool
          .filter((p) => p.item.source === s.key)
          .sort(
            (x, y) => levelGap(x.item.difficulty) - levelGap(y.item.difficulty),
          ),
      );
      const ordered: typeof pool = [];
      for (let i = 0; ordered.length < pool.length; i += 1)
        for (const list of bySource) {
          const next = list[i];
          if (next !== undefined) ordered.push(next);
        }
      // Replaced whole, as the worker does: a smaller pool leaves no stale ranks.
      await db
        .deleteFrom("user_feed_entry")
        .where("user_id", "=", user)
        .where("chip", "=", chip)
        .execute();
      const rows = ordered.slice(0, FEED_PER_CHIP).map((card, n) => {
        const reason = reasonFor(card.item, card.ordinal);
        return {
          user_id: user,
          chip,
          rank: n + 1,
          moment_id: card.momentId,
          content_item_id: card.itemId,
          // Every card here matched the user's topics.
          top_signal: reason.kind ?? "topic_match",
          reasons: reason.text,
          reason_kinds: reason.kind === null ? [] : [reason.kind],
          difficulty: card.item.difficulty,
          note_id: null,
          explore_kind: null,
          explore_arm: null,
        };
      });
      if (rows.length > 0)
        await db.insertInto("user_feed_entry").values(rows).execute();
      count("user_feed_entry", rows.length);
    }
    const computed_at = ago(30 * 60_000);
    await db
      .insertInto("user_feed_state")
      .values({ user_id: user, computed_at })
      .onConflict((oc) => oc.column("user_id").doUpdateSet({ computed_at }))
      .execute();
  }
  return counts;
}

// A game's board score, on the board its attempt belongs to (as valkey-leaderboards
// names it: the daily's day, or the sprint's ISO week).
async function boardScore(db: Kysely<DB>, attemptId: string, score: number) {
  await sql`
    insert into board_score (attempt_id, board, score)
    select a.id,
           case when a.daily_day is not null
                then 'daily:' || to_char(a.daily_day, 'YYYY-MM-DD')
                else 'sprint:' || to_char(a.started_at at time zone 'utc', 'IYYY-"W"IW')
           end,
           ${score}
    from quiz_attempt a where a.id = ${attemptId}
    on conflict (attempt_id) do nothing
  `.execute(db);
}

async function main() {
  const url = process.env["DATABASE_URL"];
  const valkeyUrl = process.env["VALKEY_URL"];
  if (url === undefined || valkeyUrl === undefined) {
    console.error("usage: pnpm demo:seed  (DATABASE_URL and VALKEY_URL set)");
    process.exit(1);
  }
  for (const [name, raw] of [
    ["DATABASE_URL", url],
    ["VALKEY_URL", valkeyUrl],
  ] as const) {
    const check = localOnly(name, raw);
    if (!check.ok) {
      console.error(
        `refusing: ${check.reason}; demo data is for local services only`,
      );
      process.exit(1);
    }
  }

  const db = createDb(url);
  const redis = new Redis(valkeyUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    const counts = await db.transaction().execute(seed);
    // The boards are Valkey's copies of board_score: drop the players' so they rebuild.
    const boards = valkeyLeaderboards(db, redis);
    for (const user of PLAYERS) await boards.invalidate(user);
    console.log("demo data in place (rows ensured):");
    for (const [what, n] of Object.entries(counts))
      console.log(`  ${what}: ${String(n)}`);
  } finally {
    redis.disconnect();
    await db.destroy();
  }
}

// Run as a script; a test imports localOnly without seeding anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
