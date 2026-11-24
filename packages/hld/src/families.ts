import type { ComponentKind } from "./catalog";
import type { DesignEdge, DesignNode } from "./design";
import type { Family, FamilyTemplate } from "./family";

// P6-W40 (HLDQ-2; Q-P6-04), ADR-0050 stage 0: the families, PROVISIONAL until the owner
// reviews them, each in the practice or the battle pool (docs/hld-catalog.md). A
// relational primary's writes stay under 60% of its 2,000 a second at three times
// baseline (the sizer can't add primaries, and grows replicas for a hot one), and each
// family's traffic within what its shape can carry, so the sizer can find a reference
// design.

const z3 = { zones: 3, regions: 1 };
const users: DesignNode = { id: "users", kind: "client", config: {}, note: "" };
const lb: DesignNode = {
  id: "lb",
  kind: "load_balancer",
  config: z3,
  note: "Spreads requests over the service's nodes in every zone.",
};
const app = (id: string, note: string): DesignNode => ({
  id,
  kind: "app_service",
  config: { nodes: 3, ...z3 },
  note,
});
const cache = (id: string, note: string): DesignNode => ({
  id,
  kind: "cache",
  config: { nodes: 3, memoryGbPerNode: 16, ...z3 },
  note,
});
const sql = (id: string, note: string): DesignNode => ({
  id,
  kind: "sql_db",
  config: {
    readReplicas: 1,
    storageGb: 100,
    failover: "multi_zone",
    regions: 1,
  },
  note,
});
const kv = (id: string, note: string): DesignNode => ({
  id,
  kind: "kv_store",
  config: { nodes: 3, replication: 3, ...z3 },
  note,
});
const queue = (id: string, note: string): DesignNode => ({
  id,
  kind: "queue",
  config: { partitions: 3, retentionHours: 24, ...z3 },
  note,
});
const stream = (id: string, note: string): DesignNode => ({
  id,
  kind: "stream",
  config: { partitions: 3, replication: 3, ...z3 },
  note,
});
const workers = (id: string, note: string): DesignNode => ({
  id,
  kind: "worker",
  config: { nodes: 3, ...z3 },
  note,
});
const objects = (id: string, note: string): DesignNode => ({
  id,
  kind: "object_storage",
  config: { regions: 1 },
  note,
});
const cdn = (id: string, ttlSeconds: number, note: string): DesignNode => ({
  id,
  kind: "cdn",
  config: { ttlSeconds },
  note,
});
// Spec 2.0: a third party, at its problem's rate limit and price.
const provider = (id: string, note: string): DesignNode => ({
  id,
  kind: "external_api",
  config: {},
  note,
});
const e = (from: string, to: string, ...routes: string[]): DesignEdge => ({
  from,
  to,
  routes,
});

// A requirement covered once its request type is served through one of `through`'s
// kinds (Q-WD-15); `fast` holds it to the normal day's p99 target too.
const served = (
  text: string,
  request: string,
  through: ComponentKind[],
  fast?: true,
): Family["requirements"][number] => ({
  text,
  covers: { rule: "request", request, through, ...(fast && { fast }) },
});
const STORES: ComponentKind[] = ["sql_db", "kv_store"];

const rubric = (...criteria: [string, string][]) =>
  criteria.map(([id, criterion]) => ({ id, criterion, weight: 1 }));

export const FAMILIES: readonly Family[] = [
  {
    slug: "url-shortener",
    pool: "practice",
    theme: "infrastructure",
    difficulty: "easy",
    title: "URL shortener",
    requirements: [
      served("Create a short code for a long URL.", "create", STORES),
      served(
        "Redirect a short code to its URL, fast.",
        "redirect",
        ["cdn", "cache", ...STORES],
        true,
      ),
    ],
    concepts: ["caching", "replication", "read-heavy workloads"],
    rubric: rubric(
      [
        "caching",
        "Caches redirects and explains how a changed or deleted link leaves the cache.",
      ],
      ["codes", "Explains how short codes are generated without collisions."],
    ),
    allowedComponents: [
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "kv_store",
      "cdn",
    ],
    requests: [
      { type: "redirect", kind: "read", cacheable: true, share: 0.98 },
      { type: "create", kind: "write", cacheable: false, share: 0.02 },
    ],
    ranges: {
      human: {
        rps: [6_000, 12_000],
        workingSetGb: [10, 60],
        hotKeySkew: [0.6, 0.9],
        storedGb: [100, 400],
        growthGbPerDay: [1, 5],
        p99Ms: [80, 150],
      },
      ai: {
        rps: [14_000, 19_000],
        workingSetGb: [40, 120],
        hotKeySkew: [0.5, 0.8],
        storedGb: [300, 800],
        growthGbPerDay: [3, 8],
        p99Ms: [50, 90],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app("api", "Stateless: any node serves any request."),
        cache(
          "cache",
          "Hot short codes stay in memory; a miss reads the database.",
        ),
        sql(
          "db",
          "The links, with replicas for redirects and a standby in another zone.",
        ),
      ],
      edges: [
        e("users", "lb", "redirect", "create"),
        e("lb", "api", "redirect", "create"),
        e("api", "cache", "redirect"),
        e("api", "db", "redirect", "create"),
      ],
    },
    lessons: [{ id: "no-cache", targets: "peak", without: "cache" }],
    practiceSeeds: [2],
  },
  {
    slug: "photo-sharing",
    pool: "practice",
    theme: "storage",
    difficulty: "medium",
    title: "Photo sharing",
    requirements: [
      served("Upload a photo with its caption.", "upload", ["object_storage"]),
      served("View photos, mostly recent and popular ones.", "view", [
        "cdn",
        "object_storage",
      ]),
      served("Load a photo's details: caption, owner and likes.", "details", [
        "cache",
        ...STORES,
      ]),
    ],
    concepts: ["CDN", "object storage", "metadata and blobs"],
    rubric: rubric(
      [
        "blobs",
        "Keeps the photo bytes apart from their metadata, and says why.",
      ],
      ["cdn", "Explains what the CDN caches and for how long."],
    ),
    allowedComponents: [
      "cdn",
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "kv_store",
      "object_storage",
      "queue",
      "worker",
    ],
    requests: [
      { type: "view", kind: "read", cacheable: true, share: 0.9 },
      { type: "details", kind: "read", cacheable: false, share: 0.08 },
      { type: "upload", kind: "write", cacheable: false, share: 0.02 },
    ],
    ranges: {
      human: {
        rps: [5_000, 18_000],
        workingSetGb: [50, 200],
        hotKeySkew: [0.6, 0.9],
        storedGb: [200, 1_500],
        growthGbPerDay: [5, 25],
        p99Ms: [150, 250],
      },
      ai: {
        rps: [14_000, 19_000],
        workingSetGb: [150, 400],
        hotKeySkew: [0.5, 0.8],
        storedGb: [1_000, 2_500],
        growthGbPerDay: [15, 30],
        p99Ms: [110, 160],
      },
    },
    horizonDays: 180,
    shape: {
      nodes: [
        users,
        {
          id: "cdn",
          kind: "cdn",
          config: { ttlSeconds: 86_400 },
          note: "Serves popular photos from near the viewer.",
        },
        lb,
        app("api", "Stateless: any node serves any request."),
        {
          id: "photos",
          kind: "object_storage",
          config: { regions: 1 },
          note: "The photo bytes: cheap, durable, unlimited.",
        },
        sql("db", "Captions, owners and likes, with replicas for reads."),
      ],
      edges: [
        e("users", "cdn", "view"),
        e("cdn", "lb", "view"),
        e("users", "lb", "details", "upload"),
        e("lb", "api", "view", "details", "upload"),
        e("api", "photos", "view", "upload"),
        e("api", "db", "details", "upload"),
      ],
    },
    practiceSeeds: [2],
  },
  {
    slug: "news-feed",
    pool: "practice",
    theme: "feeds",
    difficulty: "medium",
    title: "News feed",
    requirements: [
      served("Post an update to your followers.", "post", STORES),
      served(
        "Read your feed: the newest posts from everyone you follow.",
        "feed",
        ["cache", ...STORES],
      ),
    ],
    concepts: ["fan-out on write", "queues", "precomputed timelines"],
    rubric: rubric(
      [
        "fanout",
        "Explains fan-out on write against fan-out on read, and what it does for accounts with millions of followers.",
      ],
      [
        "async",
        "Says why posting is asynchronous and what a follower sees meanwhile.",
      ],
    ),
    allowedComponents: [
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "kv_store",
      "queue",
      "worker",
    ],
    requests: [
      { type: "feed", kind: "read", cacheable: false, share: 0.9 },
      { type: "post", kind: "write", cacheable: false, share: 0.1 },
    ],
    ranges: {
      human: {
        rps: [3_000, 12_000],
        workingSetGb: [20, 100],
        hotKeySkew: [0.3, 0.6],
        storedGb: [50, 300],
        growthGbPerDay: [1, 5],
        p99Ms: [60, 120],
      },
      ai: {
        rps: [10_000, 20_000],
        workingSetGb: [80, 200],
        hotKeySkew: [0.3, 0.6],
        storedGb: [200, 600],
        growthGbPerDay: [3, 8],
        p99Ms: [40, 70],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app(
          "api",
          "Stateless: reads a timeline, or hands a post to the queue.",
        ),
        kv(
          "timelines",
          "Each user's feed, written ahead of time so a read is one lookup.",
        ),
        queue("posts", "Posts wait here so posting stays fast."),
        workers("fanout", "Copies each post into its followers' timelines."),
      ],
      edges: [
        e("users", "lb", "feed", "post"),
        e("lb", "api", "feed", "post"),
        e("api", "timelines", "feed"),
        e("api", "posts", "post"),
        e("posts", "fanout", "post"),
        e("fanout", "timelines", "post"),
      ],
    },
    practiceSeeds: [1],
  },
  {
    slug: "chat",
    pool: "battle",
    theme: "messaging",
    difficulty: "medium",
    title: "Chat",
    requirements: [
      served("Send a message to a conversation.", "send", [
        "stream",
        "queue",
        ...STORES,
      ]),
      served(
        "Deliver it to the recipient, even if they're offline.",
        "send",
        STORES,
      ),
      served("Load a conversation's recent history.", "history", [
        "cache",
        ...STORES,
      ]),
    ],
    concepts: ["streams", "ordering", "write-heavy workloads"],
    rubric: rubric(
      ["ordering", "Explains how messages in one conversation stay in order."],
      [
        "delivery",
        "Says what happens to a message while its recipient is offline.",
      ],
    ),
    allowedComponents: [
      "load_balancer",
      "app_service",
      "cache",
      "kv_store",
      "stream",
      "queue",
      "worker",
    ],
    requests: [
      { type: "history", kind: "read", cacheable: false, share: 0.7 },
      { type: "send", kind: "write", cacheable: false, share: 0.3 },
    ],
    ranges: {
      human: {
        rps: [3_000, 10_000],
        workingSetGb: [20, 80],
        hotKeySkew: [0.2, 0.5],
        storedGb: [100, 500],
        growthGbPerDay: [2, 8],
        p99Ms: [60, 120],
      },
      ai: {
        rps: [8_000, 15_000],
        workingSetGb: [60, 160],
        hotKeySkew: [0.2, 0.5],
        storedGb: [400, 1_000],
        growthGbPerDay: [5, 12],
        p99Ms: [45, 80],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app("api", "Stateless: appends to the stream, or reads history."),
        stream(
          "messages",
          "Partitioned by conversation, so each one stays in order.",
        ),
        workers("store", "Writes each message to the conversation's history."),
        kv("history", "Each conversation's messages, by time."),
      ],
      edges: [
        e("users", "lb", "history", "send"),
        e("lb", "api", "history", "send"),
        e("api", "messages", "send"),
        e("messages", "store", "send"),
        e("store", "history", "send"),
        e("api", "history", "history"),
      ],
    },
    practiceSeeds: [1],
  },
  {
    slug: "search-autocomplete",
    pool: "practice",
    theme: "search",
    difficulty: "medium",
    title: "Search and autocomplete",
    requirements: [
      served("Suggest completions as a user types.", "suggest", [
        "cache",
        "search_index",
      ]),
      served("Search documents by text and filters.", "search", [
        "search_index",
      ]),
      served("Index new and changed documents within a minute.", "index", [
        "search_index",
      ]),
    ],
    concepts: ["search indexes", "sharding", "caching"],
    rubric: rubric(
      [
        "shards",
        "Explains how the index is sharded and replicated, and what a query costs.",
      ],
      [
        "freshness",
        "Says how a new document reaches the index, and how long that takes.",
      ],
    ),
    allowedComponents: [
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "search_index",
      "queue",
      "worker",
    ],
    requests: [
      { type: "suggest", kind: "read", cacheable: true, share: 0.6 },
      { type: "search", kind: "read", cacheable: false, share: 0.35 },
      { type: "index", kind: "write", cacheable: false, share: 0.05 },
    ],
    ranges: {
      human: {
        rps: [1_000, 3_000],
        workingSetGb: [5, 30],
        hotKeySkew: [0.6, 0.9],
        storedGb: [50, 300],
        growthGbPerDay: [0.5, 3],
        p99Ms: [100, 200],
      },
      ai: {
        rps: [2_500, 3_500],
        workingSetGb: [20, 60],
        hotKeySkew: [0.5, 0.8],
        storedGb: [200, 600],
        growthGbPerDay: [2, 5],
        p99Ms: [70, 120],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app(
          "api",
          "Stateless: answers suggestions from the cache when it can.",
        ),
        cache("suggestions", "Popular prefixes' completions."),
        {
          id: "index",
          kind: "search_index",
          config: { shards: 4, replicas: 1, ...z3 },
          note: "Shards spread the documents; replicas add query capacity.",
        },
        queue("changes", "New and changed documents wait here to be indexed."),
        workers(
          "indexers",
          "Write each document to the database and the index.",
        ),
        sql("documents", "The documents themselves, the source of truth."),
      ],
      edges: [
        e("users", "lb", "suggest", "search", "index"),
        e("lb", "api", "suggest", "search", "index"),
        e("api", "suggestions", "suggest"),
        e("api", "index", "suggest", "search"),
        e("api", "changes", "index"),
        e("changes", "indexers", "index"),
        e("indexers", "documents", "index"),
        e("indexers", "index", "index"),
      ],
    },
    lessons: [{ id: "no-cache", targets: "peak", without: "suggestions" }],
    practiceSeeds: [1],
  },
  {
    slug: "checkout",
    pool: "battle",
    theme: "commerce",
    difficulty: "medium",
    title: "Checkout",
    requirements: [
      served("Browse products and their prices.", "browse", [
        "cdn",
        "cache",
        ...STORES,
      ]),
      served("Place an order, charged exactly once.", "order", ["sql_db"]),
      served("Check an order's status.", "status", ["cache", ...STORES]),
    ],
    concepts: ["transactions", "idempotency", "queues"],
    rubric: rubric(
      [
        "once",
        "Explains how an order is charged exactly once, retries included.",
      ],
      [
        "fulfilment",
        "Says what happens after an order is placed, and what the buyer sees meanwhile.",
      ],
    ),
    allowedComponents: [
      "cdn",
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "queue",
      "worker",
    ],
    requests: [
      { type: "browse", kind: "read", cacheable: true, share: 0.91 },
      { type: "status", kind: "read", cacheable: false, share: 0.07 },
      { type: "order", kind: "write", cacheable: false, share: 0.02 },
    ],
    ranges: {
      human: {
        rps: [5_000, 9_000],
        workingSetGb: [5, 40],
        hotKeySkew: [0.6, 0.9],
        storedGb: [50, 300],
        growthGbPerDay: [0.5, 3],
        p99Ms: [80, 150],
      },
      ai: {
        rps: [14_000, 19_000],
        workingSetGb: [20, 80],
        hotKeySkew: [0.5, 0.8],
        storedGb: [200, 600],
        growthGbPerDay: [2, 5],
        p99Ms: [50, 90],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app("api", "Stateless: every order carries an idempotency key."),
        cache(
          "catalog",
          "Products and prices, read far more than they change.",
        ),
        sql(
          "orders",
          "Orders and payments in one transaction, on the primary.",
        ),
        queue("placed", "Placed orders wait here for fulfilment."),
        workers("fulfilment", "Reserve stock and ship, retrying safely."),
      ],
      edges: [
        e("users", "lb", "browse", "status", "order"),
        e("lb", "api", "browse", "status", "order"),
        e("api", "catalog", "browse"),
        e("api", "orders", "browse", "status", "order"),
        e("api", "placed", "order"),
        e("placed", "fulfilment", "order"),
      ],
    },
    lessons: [{ id: "no-cache", targets: "peak", without: "catalog" }],
    practiceSeeds: [2],
  },
  {
    slug: "metrics-ingestion",
    pool: "battle",
    theme: "pipelines",
    difficulty: "medium",
    title: "Metrics ingestion",
    requirements: [
      served("Accept metric points from many services.", "ingest", STORES),
      served("Query recent points for a dashboard.", "query", [
        "cache",
        ...STORES,
      ]),
    ],
    concepts: ["streams", "batching", "time series"],
    rubric: rubric(
      [
        "backpressure",
        "Explains what happens when points arrive faster than they're written.",
      ],
      ["retention", "Says how long points are kept, and at what resolution."],
    ),
    allowedComponents: [
      "load_balancer",
      "app_service",
      "cache",
      "kv_store",
      "stream",
      "queue",
      "worker",
      "object_storage",
    ],
    requests: [
      { type: "ingest", kind: "write", cacheable: false, share: 0.95 },
      { type: "query", kind: "read", cacheable: false, share: 0.05 },
    ],
    ranges: {
      human: {
        rps: [3_000, 7_000],
        workingSetGb: [10, 50],
        hotKeySkew: [0.2, 0.5],
        storedGb: [100, 500],
        growthGbPerDay: [2, 8],
        p99Ms: [60, 120],
      },
      ai: {
        rps: [6_000, 9_000],
        workingSetGb: [40, 100],
        hotKeySkew: [0.2, 0.5],
        storedGb: [400, 1_000],
        growthGbPerDay: [5, 12],
        p99Ms: [45, 80],
      },
    },
    horizonDays: 90,
    shape: {
      nodes: [
        users,
        lb,
        app(
          "collector",
          "Stateless: accepts points and appends them to the stream.",
        ),
        stream("points", "Absorbs bursts; partitioned by series."),
        workers("writers", "Batch points into the store."),
        kv("series", "Points by series and time."),
      ],
      edges: [
        e("users", "lb", "ingest", "query"),
        e("lb", "collector", "ingest", "query"),
        e("collector", "points", "ingest"),
        e("points", "writers", "ingest"),
        e("writers", "series", "ingest"),
        e("collector", "series", "query"),
      ],
    },
    practiceSeeds: [1],
  },
  {
    slug: "rate-limiter",
    pool: "battle",
    theme: "infrastructure",
    difficulty: "medium",
    title: "Rate limiter",
    requirements: [
      served(
        "Allow or refuse each API request against its client's limits, adding very little latency.",
        "check",
        ["cache", "kv_store"],
        true,
      ),
      served("Change a client's limits without a restart.", "rules", STORES),
    ],
    concepts: ["counters", "consistency", "latency budgets"],
    rubric: rubric(
      [
        "algorithm",
        "Names the limiting algorithm (token bucket, sliding window) and why.",
      ],
      [
        "failure",
        "Says whether requests are allowed or refused when the counters can't be reached.",
      ],
    ),
    allowedComponents: [
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "kv_store",
    ],
    requests: [
      { type: "check", kind: "write", cacheable: false, share: 0.97 },
      { type: "rules", kind: "read", cacheable: true, share: 0.03 },
    ],
    ranges: {
      human: {
        rps: [5_000, 18_000],
        workingSetGb: [1, 5],
        hotKeySkew: [0.5, 0.8],
        storedGb: [1, 10],
        growthGbPerDay: [0, 0.5],
        p99Ms: [40, 80],
      },
      ai: {
        rps: [15_000, 25_000],
        workingSetGb: [2, 8],
        hotKeySkew: [0.5, 0.8],
        storedGb: [5, 20],
        growthGbPerDay: [0, 1],
        p99Ms: [30, 50],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app("gateway", "Stateless: checks every request before passing it on."),
        kv("counters", "Each client's counters, updated on every request."),
        cache("limits", "Clients' limits, read-through from the database."),
        sql("rules", "Clients' limits, the source of truth."),
      ],
      edges: [
        e("users", "lb", "check", "rules"),
        e("lb", "gateway", "check", "rules"),
        e("gateway", "counters", "check"),
        e("gateway", "limits", "rules"),
        e("limits", "rules", "rules"),
      ],
    },
    practiceSeeds: [2],
  },
  // ADR-0050 stage 0 (docs/hld-catalog.md; Q-WD-31): four families the v1 engine can
  // already simulate, PROVISIONAL like the rest. Numbers differ from the catalog's
  // draft where a relational primary's 2,000 writes a second or the v1 engine's
  // zone scenario needed it.
  {
    slug: "qa-forum",
    pool: "battle",
    theme: "feeds",
    difficulty: "easy",
    title: "Questions and answers forum",
    requirements: [
      served(
        "Show a question with its answers, fast, mostly to readers who aren't signed in.",
        "question_page",
        ["cdn", "cache", "sql_db"],
        true,
      ),
      served("Search questions by their words.", "search", ["search_index"]),
      served("Post an answer.", "answer", ["sql_db"]),
      served("Vote an answer up or down.", "vote", ["sql_db"]),
    ],
    concepts: ["caching", "read replicas", "read-heavy workloads"],
    rubric: rubric(
      [
        "fresh",
        "Explains how a new answer shows up on a cached page: a short TTL or a purge.",
      ],
      [
        "votes",
        "Says how vote counts avoid one hot row being locked by every voter.",
      ],
    ),
    allowedComponents: [
      "cdn",
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "search_index",
    ],
    requests: [
      { type: "question_page", kind: "read", cacheable: true, share: 0.925 },
      { type: "search", kind: "read", cacheable: false, share: 0.053 },
      { type: "vote", kind: "write", cacheable: false, share: 0.015 },
      { type: "answer", kind: "write", cacheable: false, share: 0.007 },
    ],
    ranges: {
      human: {
        rps: [7_500, 9_500],
        workingSetGb: [10, 50],
        hotKeySkew: [0.6, 0.9],
        storedGb: [100, 500],
        growthGbPerDay: [1, 3],
        p99Ms: [120, 200],
      },
      ai: {
        rps: [15_000, 17_000],
        workingSetGb: [40, 100],
        hotKeySkew: [0.5, 0.8],
        storedGb: [400, 900],
        growthGbPerDay: [2, 5],
        p99Ms: [90, 140],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app("api", "Stateless: pages from the cache, writes to the primary."),
        cache("pages", "Rendered question pages, for a short time."),
        {
          id: "index",
          kind: "search_index",
          config: { shards: 2, replicas: 1, ...z3 },
          note: "Questions by their words.",
        },
        sql(
          "db",
          "Questions, answers and votes, with replicas for page misses.",
        ),
      ],
      edges: [
        e("users", "lb", "question_page", "search", "vote", "answer"),
        e("lb", "api", "question_page", "search", "vote", "answer"),
        e("api", "pages", "question_page"),
        e("api", "db", "question_page", "vote", "answer"),
        e("api", "index", "search", "answer"),
      ],
    },
    lessons: [{ id: "no-cache", targets: "peak", without: "pages" }],
  },
  {
    slug: "hotel-booking",
    pool: "practice",
    theme: "commerce",
    difficulty: "medium",
    title: "Hotel room booking",
    requirements: [
      served(
        "Show which rooms are free in a city on given dates, fast; a few seconds stale is fine.",
        "availability",
        ["cache", "search_index"],
        true,
      ),
      served("Book a room, never selling a room-night twice.", "book", [
        "sql_db",
      ]),
      served("Take hotels' price and stock changes.", "partner_update", [
        "sql_db",
        "queue",
      ]),
    ],
    concepts: ["caching", "transactions", "search indexes"],
    rubric: rubric(
      [
        "twice",
        "Explains how a room-night is never sold twice: a conditional update or a row lock on the primary.",
      ],
      [
        "stale",
        "Says what a guest sees when the cached availability was wrong at booking time.",
      ],
    ),
    allowedComponents: [
      "cdn",
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "search_index",
      "queue",
      "worker",
    ],
    requests: [
      { type: "availability", kind: "read", cacheable: true, share: 0.945 },
      { type: "partner_update", kind: "write", cacheable: false, share: 0.04 },
      { type: "book", kind: "write", cacheable: false, share: 0.015 },
    ],
    ranges: {
      human: {
        rps: [2_200, 3_800],
        workingSetGb: [5, 30],
        hotKeySkew: [0.6, 0.9],
        storedGb: [50, 300],
        growthGbPerDay: [0.5, 2],
        p99Ms: [120, 200],
      },
      ai: {
        rps: [4_400, 5_600],
        workingSetGb: [20, 60],
        hotKeySkew: [0.5, 0.8],
        storedGb: [200, 500],
        growthGbPerDay: [1, 3],
        p99Ms: [90, 140],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app(
          "api",
          "Stateless: searches the cache first, books on the primary.",
        ),
        cache("rooms", "Recent answers for a city and dates."),
        {
          id: "index",
          kind: "search_index",
          config: { shards: 2, replicas: 2, ...z3 },
          note: "Free rooms by city and date, a few seconds behind.",
        },
        queue("updates", "Hotels' changes wait here."),
        workers("sync", "Apply each change to the database and the index."),
        sql("inventory", "Rooms, room-nights and bookings, the truth."),
      ],
      edges: [
        e("users", "lb", "availability", "book", "partner_update"),
        e("lb", "api", "availability", "book", "partner_update"),
        e("api", "rooms", "availability"),
        e("api", "index", "availability"),
        e("api", "inventory", "book"),
        e("api", "updates", "partner_update"),
        e("updates", "sync", "partner_update"),
        e("sync", "inventory", "partner_update"),
        e("sync", "index", "partner_update"),
      ],
    },
    lessons: [{ id: "no-cache", targets: "peak", without: "rooms" }],
    practiceSeeds: [1],
  },
  {
    slug: "product-search",
    pool: "battle",
    theme: "search",
    difficulty: "medium",
    title: "Marketplace product search",
    requirements: [
      served(
        "Search products by text, filters and facets, fast.",
        "search",
        ["search_index"],
        true,
      ),
      served("Show a product's page.", "product_page", [
        "cdn",
        "cache",
        "sql_db",
      ]),
      served(
        "Take sellers' price and stock changes, searchable within a minute.",
        "stock_change",
        ["stream", "queue"],
      ),
      {
        text: "Keep searching when a search node fails during a sale.",
        covers: { rule: "scenario", scenario: "search_node" },
      },
    ],
    concepts: ["search indexes", "replicas and shards", "streams"],
    rubric: rubric(
      [
        "replicas",
        "Explains what shards buy (room for the data) and what replicas buy (query capacity, surviving a node).",
      ],
      [
        "stale",
        "Says how a seller's change reaches the index, and why search may be briefly behind.",
      ],
    ),
    allowedComponents: [
      "cdn",
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "search_index",
      "stream",
      "queue",
      "worker",
    ],
    requests: [
      { type: "search", kind: "read", cacheable: false, share: 0.7 },
      { type: "product_page", kind: "read", cacheable: true, share: 0.25 },
      { type: "stock_change", kind: "write", cacheable: false, share: 0.05 },
    ],
    ranges: {
      human: {
        rps: [1_200, 2_400],
        workingSetGb: [10, 40],
        hotKeySkew: [0.5, 0.8],
        storedGb: [200, 1_000],
        growthGbPerDay: [2, 6],
        p99Ms: [150, 250],
      },
      ai: {
        rps: [2_400, 3_400],
        workingSetGb: [30, 80],
        hotKeySkew: [0.5, 0.8],
        storedGb: [600, 1_500],
        growthGbPerDay: [4, 8],
        p99Ms: [110, 170],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app("api", "Stateless: queries the index, pages from the cache."),
        {
          id: "index",
          kind: "search_index",
          config: { shards: 4, replicas: 1, ...z3 },
          note: "Shards hold the catalog; replicas carry queries and cover a lost node.",
        },
        cache("pages", "Product pages, read far more than they change."),
        sql("catalog", "Products, prices and stock: the catalog of record."),
        stream("changes", "Sellers' changes, in order per product."),
        workers("indexers", "Apply each change to the catalog and the index."),
      ],
      edges: [
        e("users", "lb", "search", "product_page", "stock_change"),
        e("lb", "api", "search", "product_page", "stock_change"),
        e("api", "index", "search"),
        e("api", "pages", "product_page"),
        e("api", "catalog", "product_page"),
        e("api", "changes", "stock_change"),
        e("changes", "indexers", "stock_change"),
        e("indexers", "catalog", "stock_change"),
        e("indexers", "index", "stock_change"),
      ],
    },
    scenarios: [
      {
        id: "search_node",
        name: "A search node fails during a sale",
        weight: 2,
        load: 1.5,
        failure: { scope: "node", kind: "search_index" },
        p99x: 1.5,
        availability: 0.995,
      },
    ],
  },
  {
    slug: "distributed-cache",
    pool: "practice",
    theme: "infrastructure",
    difficulty: "medium",
    title: "A caching tier for a slow database",
    requirements: [
      served("Read a value by key, fast.", "get", ["cache"], true),
      served("Write a value, kept in the database.", "put", ["sql_db"]),
      {
        text: "Keep the database standing when a cache node dies at the evening peak.",
        covers: { rule: "scenario", scenario: "cache_node" },
      },
    ],
    concepts: ["caching", "consistent hashing", "cache stampedes"],
    rubric: rubric(
      [
        "spread",
        "Explains how keys are spread so that adding or losing a node moves few of them (consistent hashing).",
      ],
      [
        "stampede",
        "Says how writes invalidate cached values, and how the database is protected from a stampede of misses.",
      ],
    ),
    allowedComponents: ["load_balancer", "app_service", "cache", "sql_db"],
    requests: [
      { type: "get", kind: "read", cacheable: true, share: 0.985 },
      { type: "put", kind: "write", cacheable: false, share: 0.015 },
    ],
    ranges: {
      human: {
        rps: [14_000, 15_500],
        workingSetGb: [50, 300],
        hotKeySkew: [0, 0.1],
        storedGb: [200, 800],
        growthGbPerDay: [0.5, 2],
        p99Ms: [40, 80],
      },
      ai: {
        rps: [28_000, 32_000],
        workingSetGb: [100, 300],
        hotKeySkew: [0, 0.1],
        storedGb: [400, 1_000],
        growthGbPerDay: [1, 3],
        p99Ms: [30, 50],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app("api", "Stateless: reads the cache first, the database on a miss."),
        {
          id: "cache",
          kind: "cache",
          config: { nodes: 6, memoryGbPerNode: 16, ...z3 },
          note: "Many small nodes: losing one loses little of the working set.",
        },
        {
          id: "db",
          kind: "sql_db",
          config: {
            readReplicas: 0,
            storageGb: 100,
            failover: "multi_zone",
            regions: 1,
          },
          note: "The slow database of record, kept away from most reads.",
        },
      ],
      edges: [
        e("users", "lb", "get", "put"),
        e("lb", "api", "get", "put"),
        e("api", "cache", "get"),
        e("api", "db", "get", "put"),
      ],
    },
    scenarios: [
      {
        id: "cache_node",
        name: "A cache node dies at the evening peak",
        weight: 2,
        load: 2,
        failure: { scope: "node", kind: "cache" },
        p99x: 2,
        availability: 0.995,
      },
    ],
    lessons: [
      {
        id: "two-big-nodes",
        targets: "cache_node",
        node: "cache",
        // The same memory on two nodes: one's loss takes half the working set.
        configure: (c) => ({
          nodes: 2,
          memoryGbPerNode: Math.min(
            256,
            Math.ceil((Number(c["nodes"]) * Number(c["memoryGbPerNode"])) / 2),
          ),
        }),
      },
    ],
    practiceSeeds: [1],
  },
  // ADR-0050 stage 1 (spec 2.0, from SPEC_V2_FROM): the families that need only the
  // external provider, backlog and lag, work units and bytes, PROVISIONAL like the rest.
  // Where a number differs from the catalog's plan, it is so the simulator shows the
  // lesson: docs/hld-catalog.md, "Stage 1 as built", lists each.
  {
    slug: "otp-login",
    spec: "2.0",
    pool: "practice",
    theme: "messaging",
    difficulty: "easy",
    title: "One-time code sign-in",
    requirements: [
      served(
        "Check a signed-in session, fast.",
        "session",
        ["kv_store", "cache"],
        true,
      ),
      served(
        "Send a one-time code by SMS, delivered within 15 minutes.",
        "request_code",
        ["external_api"],
        true,
      ),
      served("Check a code someone typed, fast.", "verify", ["kv_store"], true),
      {
        text: "Keep signing people in while the SMS provider is down for 10 minutes.",
        covers: { rule: "scenario", scenario: "provider_down" },
      },
    ],
    concepts: ["queues", "third-party providers", "retries"],
    rubric: rubric(
      [
        "limits",
        "Says how codes expire, how many tries a code gets, and how sends are capped per phone number, and why.",
      ],
      [
        "delay",
        "Explains what the person signing in sees while a code is delayed, and why the send is off the request.",
      ],
    ),
    allowedComponents: [
      "load_balancer",
      "app_service",
      "cache",
      "kv_store",
      "queue",
      "worker",
      "external_api",
    ],
    requests: [
      { type: "session", kind: "read", cacheable: false, share: 0.88 },
      {
        type: "request_code",
        kind: "write",
        cacheable: false,
        share: 0.04,
        completionSeconds: 900,
        requires: ["external_api"],
      },
      { type: "verify", kind: "write", cacheable: false, share: 0.08 },
    ],
    providerCostPerCall: 0.0005,
    ranges: {
      human: {
        rps: [2_000, 4_000],
        workingSetGb: [1, 5],
        hotKeySkew: [0.3, 0.6],
        storedGb: [1, 5],
        growthGbPerDay: [0.05, 0.2],
        p99Ms: [400, 600],
        providerShare: [0.17, 0.23],
      },
      ai: {
        rps: [4_000, 6_000],
        workingSetGb: [3, 10],
        hotKeySkew: [0.3, 0.6],
        storedGb: [3, 10],
        growthGbPerDay: [0.1, 0.4],
        p99Ms: [350, 450],
        providerShare: [0.17, 0.23],
      },
    },
    horizonDays: 30,
    shape: {
      nodes: [
        users,
        lb,
        app("api", "Stateless: checks sessions and codes, queues every send."),
        kv("codes", "Sessions and codes, each with its expiry."),
        queue(
          "sends",
          "Codes to send: a slow or down provider only delays them.",
        ),
        workers(
          "senders",
          "Send each code through the SMS provider, retrying.",
        ),
        provider(
          "sms",
          "The SMS provider: its rate limit, its price, its outages.",
        ),
      ],
      edges: [
        e("users", "lb", "session", "request_code", "verify"),
        e("lb", "api", "session", "request_code", "verify"),
        e("api", "codes", "session", "request_code", "verify"),
        e("api", "sends", "request_code"),
        e("sends", "senders", "request_code"),
        e("senders", "sms", "request_code"),
      ],
    },
    scenarios: [
      {
        id: "provider_down",
        name: "The SMS provider is down for 10 minutes",
        weight: 2,
        load: 1,
        minutes: 10,
        failure: { scope: "node", kind: "external_api" },
        p99x: 1.5,
        availability: 0.99,
      },
    ],
    lessons: [
      // The provider called inside the request: its outage fails every send.
      {
        id: "provider-inline",
        targets: "provider_down",
        bypass: ["sends", "senders"],
      },
      // No provider: codes are stored and queued, and never sent.
      { id: "no-provider", targets: "baseline", without: "sms" },
    ],
    practiceSeeds: [1],
  },
  {
    slug: "webhook-delivery",
    spec: "2.0",
    pool: "practice",
    theme: "messaging",
    difficulty: "medium",
    title: "Webhook delivery",
    requirements: [
      served(
        "Deliver each event to the customer's URL within 2 hours, retrying while it's down.",
        "event",
        ["external_api"],
        true,
      ),
      served("Show customers their delivery log.", "status", [
        "kv_store",
        "sql_db",
      ]),
      {
        text: "Lose no event while customers' endpoints are down for 30 minutes.",
        covers: { rule: "scenario", scenario: "endpoints_down" },
      },
    ],
    concepts: ["queues", "retries and backoff", "at-least-once delivery"],
    rubric: rubric(
      [
        "retries",
        "Explains retries with backoff, when to give up (a dead-letter queue), and how one slow customer doesn't hold up the rest.",
      ],
      [
        "receivers",
        "Says how payloads are signed, and why customers must handle the same event twice.",
      ],
    ),
    allowedComponents: [
      "load_balancer",
      "app_service",
      "kv_store",
      "sql_db",
      "queue",
      "stream",
      "worker",
      "external_api",
    ],
    requests: [
      {
        type: "event",
        kind: "write",
        cacheable: false,
        share: 0.8,
        completionSeconds: 7_200,
        requires: ["external_api"],
      },
      { type: "status", kind: "read", cacheable: false, share: 0.2 },
    ],
    providerCostPerCall: 0,
    ranges: {
      human: {
        rps: [2_000, 6_000],
        workingSetGb: [10, 40],
        hotKeySkew: [0.3, 0.6],
        storedGb: [200, 800],
        growthGbPerDay: [5, 15],
        p99Ms: [100, 200],
        providerShare: [1.3, 1.4],
      },
      ai: {
        rps: [6_000, 9_000],
        workingSetGb: [30, 80],
        hotKeySkew: [0.3, 0.6],
        storedGb: [600, 1_200],
        growthGbPerDay: [10, 25],
        p99Ms: [80, 140],
        providerShare: [1.3, 1.4],
      },
    },
    horizonDays: 30,
    shape: {
      nodes: [
        users,
        lb,
        app("api", "Stateless: logs each event and queues its delivery."),
        kv("log", "Every delivery attempt, for customers to read."),
        queue(
          "outbox",
          "Deliveries waiting, kept a day: long enough to outlast an outage.",
        ),
        workers("deliverers", "POST each event, retrying with backoff."),
        provider(
          "endpoints",
          "Customers' URLs: slow, rate-limited, sometimes down.",
        ),
      ],
      edges: [
        e("users", "lb", "event", "status"),
        e("lb", "api", "event", "status"),
        e("api", "log", "event", "status"),
        e("api", "outbox", "event"),
        e("outbox", "deliverers", "event"),
        e("deliverers", "endpoints", "event"),
        e("deliverers", "log", "event"),
      ],
    },
    scenarios: [
      {
        id: "endpoints_down",
        name: "Customers' endpoints are down for 30 minutes",
        weight: 2,
        load: 1,
        minutes: 30,
        failure: { scope: "node", kind: "external_api" },
        p99x: 1.5,
        availability: 0.99,
      },
    ],
    lessons: [
      // An hour's retention: the outage and its drain outlast it, and events are lost.
      {
        id: "short-retention",
        targets: "endpoints_down",
        node: "outbox",
        configure: () => ({ retentionHours: 1 }),
      },
      // No endpoints: events are logged and queued, and never delivered.
      { id: "no-provider", targets: "baseline", without: "endpoints" },
    ],
    practiceSeeds: [1],
  },
  {
    slug: "image-resizer",
    spec: "2.0",
    pool: "practice",
    theme: "storage",
    difficulty: "easy",
    title: "Image resizing service",
    requirements: [
      served(
        "Serve an image at the size a page asks for, fast.",
        "image",
        ["cdn", "object_storage"],
        true,
      ),
      served(
        "Take an uploaded original; its common sizes ready within 5 minutes.",
        "original",
        ["object_storage"],
        true,
      ),
    ],
    concepts: ["CDN", "object storage", "precomputed and on-the-fly work"],
    rubric: rubric(
      [
        "renditions",
        "Weighs resizing on the fly against sizes made at upload, and says which sizes are allowed.",
      ],
      [
        "invalidate",
        "Explains how a replaced original's old sizes leave the CDN and storage.",
      ],
    ),
    allowedComponents: [
      "cdn",
      "load_balancer",
      "app_service",
      "cache",
      "object_storage",
      "queue",
      "worker",
    ],
    requests: [
      {
        type: "image",
        kind: "read",
        cacheable: true,
        share: 0.95,
        work: 10,
      },
      {
        type: "original",
        kind: "write",
        cacheable: false,
        share: 0.05,
        work: 20,
        payloadKb: 2_000,
        completionSeconds: 300,
        requires: ["worker"],
      },
    ],
    ranges: {
      human: {
        rps: [600, 1_500],
        workingSetGb: [20, 80],
        hotKeySkew: [0.6, 0.9],
        storedGb: [500, 2_000],
        growthGbPerDay: [10, 30],
        p99Ms: [250, 400],
      },
      ai: {
        rps: [1_500, 2_200],
        workingSetGb: [40, 120],
        hotKeySkew: [0.5, 0.8],
        storedGb: [1_000, 3_000],
        growthGbPerDay: [20, 50],
        p99Ms: [200, 300],
      },
    },
    horizonDays: 180,
    shape: {
      nodes: [
        users,
        cdn("edge", 1_200, "Each size, once made, served from the edge."),
        lb,
        app("api", "Stateless: takes uploads, asks for a size on a miss."),
        workers("resizers", "Make a size from its original, once."),
        objects("files", "Originals and every size made."),
        queue("renditions", "Common sizes to make for each new original."),
      ],
      edges: [
        e("users", "edge", "image"),
        e("edge", "lb", "image"),
        e("users", "lb", "original"),
        e("lb", "api", "image", "original"),
        e("api", "resizers", "image"),
        e("resizers", "files", "image", "original"),
        e("api", "files", "original"),
        e("api", "renditions", "original"),
        e("renditions", "resizers", "original"),
      ],
    },
    lessons: [
      // Every request resized again: the spike lands on the resizers.
      { id: "no-cdn", targets: "peak", bypass: ["edge"] },
      // No queue to the resizers: originals are stored and their sizes never made.
      { id: "no-renditions", targets: "baseline", without: "renditions" },
    ],
    practiceSeeds: [1],
  },
  {
    slug: "file-sync",
    spec: "2.0",
    pool: "battle",
    theme: "storage",
    difficulty: "medium",
    title: "File sync across devices",
    requirements: [
      served(
        "Tell a device what changed since it last asked, fast.",
        "changes",
        ["sql_db", "cache"],
        true,
      ),
      served("Upload a file's changed chunks.", "upload_chunk", [
        "object_storage",
      ]),
      served("Commit a file's new version.", "commit", ["sql_db"]),
      served("Download a file.", "download", ["cdn", "object_storage"]),
    ],
    concepts: ["object storage", "signed uploads", "bandwidth"],
    rubric: rubric(
      [
        "chunks",
        "Explains chunking and deduplication by content hash, and what a one-byte edit uploads.",
      ],
      [
        "conflicts",
        "Says how two devices editing the same file are reconciled (conflict copies or versions).",
      ],
    ),
    allowedComponents: [
      "cdn",
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "object_storage",
      "queue",
      "worker",
    ],
    requests: [
      { type: "changes", kind: "read", cacheable: false, share: 0.75 },
      { type: "download", kind: "read", cacheable: true, share: 0.14 },
      {
        type: "upload_chunk",
        kind: "write",
        cacheable: false,
        share: 0.06,
        payloadKb: 4_000,
      },
      { type: "commit", kind: "write", cacheable: false, share: 0.05 },
    ],
    ranges: {
      human: {
        rps: [3_000, 6_000],
        workingSetGb: [20, 60],
        hotKeySkew: [0.3, 0.6],
        storedGb: [500, 2_000],
        growthGbPerDay: [5, 15],
        p99Ms: [150, 250],
      },
      ai: {
        rps: [6_000, 7_500],
        workingSetGb: [40, 100],
        hotKeySkew: [0.3, 0.6],
        storedGb: [1_000, 3_000],
        growthGbPerDay: [10, 20],
        p99Ms: [110, 170],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app("api", "Stateless: cursors and versions; never the bytes."),
        sql("meta", "Files, versions and each device's cursor."),
        objects(
          "chunks",
          "Chunks by content hash, uploaded straight from devices with signed URLs.",
        ),
        cdn("edge", 3_600, "Chunks downloaded from the edge."),
      ],
      edges: [
        e("users", "lb", "changes", "commit"),
        e("lb", "api", "changes", "commit"),
        e("api", "meta", "changes", "commit"),
        e("users", "chunks", "upload_chunk"),
        e("users", "edge", "download"),
        e("edge", "chunks", "download"),
      ],
    },
    // Every chunk through the app service: its bandwidth runs out in the spike.
    lessons: [
      {
        id: "uploads-through-app",
        targets: "peak",
        route: { type: "upload_chunk", path: ["users", "lb", "api", "chunks"] },
      },
    ],
  },
  {
    slug: "video-on-demand",
    spec: "2.0",
    pool: "battle",
    theme: "storage",
    difficulty: "hard",
    title: "Video streaming service",
    requirements: [
      served("Stream a video's segments, fast.", "segment", ["cdn"], true),
      served("Load a video's manifest.", "manifest", ["cdn", "object_storage"]),
      served(
        "Take an upload; its renditions ready within 30 minutes.",
        "upload",
        ["worker"],
        true,
      ),
      {
        text: "Keep transcoding on time when uploads back up for two hours.",
        covers: { rule: "scenario", scenario: "backlog" },
      },
    ],
    concepts: ["CDN", "egress cost", "transcoding pipelines"],
    rubric: rubric(
      [
        "bitrates",
        "Explains adaptive bitrate: why several renditions, and how a player picks one.",
      ],
      [
        "jobs",
        "Says what a long transcode does when a worker dies halfway (chunked jobs, retries).",
      ],
      [
        "egress",
        "Explains why segments come from a CDN, and what it costs against the origin.",
      ],
    ),
    allowedComponents: [
      "cdn",
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "object_storage",
      "queue",
      "worker",
    ],
    requests: [
      {
        type: "segment",
        kind: "read",
        cacheable: true,
        share: 0.96,
        payloadKb: 500,
      },
      { type: "manifest", kind: "read", cacheable: true, share: 0.039 },
      {
        type: "upload",
        kind: "write",
        cacheable: false,
        share: 0.001,
        work: 600,
        completionSeconds: 1_800,
        requires: ["worker"],
      },
    ],
    ranges: {
      human: {
        rps: [600, 1_500],
        workingSetGb: [100, 400],
        hotKeySkew: [0.7, 0.95],
        storedGb: [5_000, 20_000],
        growthGbPerDay: [200, 500],
        p99Ms: [150, 300],
      },
      ai: {
        rps: [1_500, 2_500],
        workingSetGb: [200, 600],
        hotKeySkew: [0.7, 0.95],
        storedGb: [10_000, 30_000],
        growthGbPerDay: [300, 700],
        p99Ms: [100, 200],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        cdn(
          "edge",
          3_600,
          "Segments and manifests from the edge: cheaper bytes.",
        ),
        objects("media", "Sources, renditions and manifests."),
        lb,
        app("api", "Stateless: takes uploads and queues their transcodes."),
        queue("jobs", "Transcodes waiting: a burst of uploads waits here."),
        workers("transcoders", "Make each rendition, in parallel."),
      ],
      edges: [
        e("users", "edge", "segment", "manifest"),
        e("edge", "media", "segment", "manifest"),
        e("users", "lb", "upload"),
        e("lb", "api", "upload"),
        e("api", "media", "upload"),
        e("api", "jobs", "upload"),
        e("jobs", "transcoders", "upload"),
        e("transcoders", "media", "upload"),
      ],
    },
    scenarios: [
      {
        id: "backlog",
        name: "Uploads back up: three times as many for two hours",
        weight: 2,
        load: 1,
        loads: { upload: 3 },
        minutes: 120,
        p99x: 1.5,
        availability: 0.995,
      },
    ],
    lessons: [
      // Segments from storage: origin bytes cost about four times a CDN's.
      { id: "no-cdn", targets: "budget", bypass: ["edge"] },
      // Transcoders sized for the average: the backlog misses its target.
      {
        id: "transcoders-for-the-average",
        targets: "backlog",
        node: "transcoders",
        utilization: 0.4,
      },
      // No queue or transcoders: uploads are stored and never transcoded.
      {
        id: "no-transcoding",
        targets: "baseline",
        without: ["jobs", "transcoders"],
      },
    ],
  },
  {
    slug: "payment-processing",
    spec: "2.0",
    pool: "battle",
    theme: "commerce",
    difficulty: "hard",
    title: "Payment processing",
    requirements: [
      served(
        "Authorize a card payment with the card network, fast.",
        "authorize",
        ["external_api"],
        true,
      ),
      served(
        "Capture an authorized payment within an hour.",
        "capture",
        ["external_api"],
        true,
      ),
      served(
        "Show a payment's status, fast.",
        "payment_status",
        ["sql_db", "cache"],
        true,
      ),
      {
        text: "When the card network is down for 5 minutes, fail authorizations honestly and capture later.",
        covers: { rule: "scenario", scenario: "network_down" },
      },
    ],
    concepts: ["third-party providers", "idempotency", "queues"],
    rubric: rubric(
      [
        "idempotency",
        "Explains what happens when the network times out after charging: idempotency keys and reconciliation.",
      ],
      [
        "two_step",
        "Says why authorization and capture are separate, and which one may wait.",
      ],
    ),
    allowedComponents: [
      "load_balancer",
      "app_service",
      "cache",
      "sql_db",
      "queue",
      "worker",
      "external_api",
    ],
    requests: [
      { type: "payment_status", kind: "read", cacheable: false, share: 0.84 },
      {
        type: "authorize",
        kind: "write",
        cacheable: false,
        share: 0.08,
        requires: ["external_api"],
      },
      {
        type: "capture",
        kind: "write",
        cacheable: false,
        share: 0.08,
        completionSeconds: 3_600,
        requires: ["external_api"],
      },
    ],
    providerCostPerCall: 0.0002,
    ranges: {
      human: {
        rps: [1_000, 2_000],
        workingSetGb: [10, 40],
        hotKeySkew: [0.3, 0.6],
        storedGb: [100, 500],
        growthGbPerDay: [1, 3],
        p99Ms: [400, 600],
        providerShare: [0.8, 1],
      },
      ai: {
        rps: [2_000, 2_400],
        workingSetGb: [30, 80],
        hotKeySkew: [0.3, 0.6],
        storedGb: [300, 800],
        growthGbPerDay: [2, 5],
        p99Ms: [350, 450],
        providerShare: [0.8, 1],
      },
    },
    horizonDays: 365,
    shape: {
      nodes: [
        users,
        lb,
        app(
          "api",
          "Stateless: authorizes in the request, queues every capture, with an idempotency key.",
        ),
        sql("payments", "Payments and idempotency keys, written once."),
        provider("network", "The card network: authorizes and captures."),
        queue("captures", "Captures waiting: an outage only delays them."),
        workers("capturers", "Capture each payment, retrying, and record it."),
      ],
      edges: [
        e("users", "lb", "payment_status", "authorize", "capture"),
        e("lb", "api", "payment_status", "authorize", "capture"),
        e("api", "payments", "payment_status", "authorize"),
        e("api", "network", "authorize"),
        e("api", "captures", "capture"),
        e("captures", "capturers", "capture"),
        e("capturers", "network", "capture"),
        e("capturers", "payments", "capture"),
      ],
    },
    scenarios: [
      {
        id: "network_down",
        name: "The card network is down for 5 minutes",
        weight: 2,
        load: 1,
        minutes: 5,
        failure: { scope: "node", kind: "external_api" },
        p99x: 1.5,
        // Authorizations fail while it's down, whatever the design.
        availability: 0.9,
      },
    ],
    lessons: [
      // Captures in the request: the outage fails them too.
      {
        id: "capture-inline",
        targets: "network_down",
        bypass: ["captures", "capturers"],
      },
      // No card network: payments are recorded and never authorized or captured.
      { id: "no-provider", targets: "baseline", without: "network" },
    ],
  },
  {
    slug: "web-crawler",
    spec: "2.0",
    pool: "battle",
    theme: "search",
    difficulty: "hard",
    title: "Web crawler",
    requirements: [
      served(
        "Fetch each queued page within an hour, at the pace sites allow.",
        "fetch",
        ["external_api"],
        true,
      ),
      served(
        "Parse each fetched page within an hour.",
        "parse",
        ["worker"],
        true,
      ),
      served(
        "Check whether a URL was seen before, fast.",
        "seen_check",
        ["cache", "kv_store"],
        true,
      ),
    ],
    concepts: ["queues", "politeness", "deduplication"],
    rubric: rubric(
      [
        "politeness",
        "Explains politeness: per-host rate limits, robots rules, and many fetches in flight per worker.",
      ],
      [
        "frontier",
        "Says how the frontier prioritises, skips URLs already seen, and avoids crawler traps.",
      ],
    ),
    allowedComponents: [
      "load_balancer",
      "app_service",
      "cache",
      "kv_store",
      "object_storage",
      "queue",
      "stream",
      "worker",
      "external_api",
    ],
    requests: [
      {
        type: "fetch",
        kind: "write",
        cacheable: false,
        share: 0.7,
        completionSeconds: 3_600,
        requires: ["external_api"],
      },
      {
        type: "parse",
        kind: "write",
        cacheable: false,
        share: 0.2,
        work: 10,
        completionSeconds: 3_600,
      },
      { type: "seen_check", kind: "read", cacheable: true, share: 0.1 },
    ],
    providerCostPerCall: 0,
    ranges: {
      human: {
        rps: [1_000, 3_000],
        workingSetGb: [20, 80],
        hotKeySkew: [0.3, 0.6],
        storedGb: [500, 2_000],
        growthGbPerDay: [50, 150],
        p99Ms: [60, 120],
        providerShare: [1.4, 1.75],
      },
      ai: {
        rps: [3_000, 4_000],
        workingSetGb: [60, 150],
        hotKeySkew: [0.3, 0.6],
        storedGb: [1_500, 3_000],
        growthGbPerDay: [100, 200],
        p99Ms: [40, 80],
        providerShare: [1.4, 1.75],
      },
    },
    horizonDays: 90,
    shape: {
      nodes: [
        users,
        queue("frontier", "URLs to fetch, in order, per host."),
        workers(
          "fetchers",
          "Many fetches in flight each, at each site's pace.",
        ),
        provider("web", "The open web: slow, rate-limited by politeness."),
        objects("pages", "Every page fetched, and its parsed text."),
        // Spec 2.0: a stream says how long its backlog may wait.
        {
          id: "parsing",
          kind: "stream",
          config: { partitions: 3, replication: 3, retentionHours: 24, ...z3 },
          note: "Fetched pages to parse, in order.",
        },
        workers("parsers", "Extract text and links."),
        lb,
        app("api", "Stateless: answers whether a URL was seen."),
        cache("recent", "URLs seen lately."),
        kv("seen", "Every URL seen, by its hash."),
      ],
      edges: [
        e("users", "frontier", "fetch"),
        e("frontier", "fetchers", "fetch"),
        e("fetchers", "web", "fetch"),
        e("fetchers", "pages", "fetch"),
        e("users", "parsing", "parse"),
        e("parsing", "parsers", "parse"),
        e("parsers", "pages", "parse"),
        e("parsers", "seen", "parse"),
        e("users", "lb", "seen_check"),
        e("lb", "api", "seen_check"),
        e("api", "recent", "seen_check"),
        e("api", "seen", "seen_check"),
      ],
    },
    // No web: URLs are queued and pages never fetched. Its own lessons (politeness,
    // duplicate URLs) are the rubric's (ADR-0051).
    lessons: [{ id: "no-provider", targets: "baseline", without: "web" }],
  },
];

// P6-W44 (§6.4, HLDQ-3, Q-P6-08): the cup problems, hand-written, PROVISIONAL until the
// owner reviews them. Validated as any variant, never in the match pool or practice: the
// admin picks them for a tournament's rounds, and they're retired once used. Each keeps
// one seed for each battle mode it validates in (`seeds`), checked by the tests.
export const CUPS: readonly {
  family: FamilyTemplate;
  seeds: Partial<Record<"human" | "ai", number>>;
}[] = [
  {
    family: {
      slug: "cup-concert-tickets",
      title: "Concert ticket sale",
      requirements: [
        served("Show a concert's seat map and prices.", "seat_map", [
          "cdn",
          "cache",
          ...STORES,
        ]),
        served(
          "Hold a seat for a buyer for a few minutes, never for two buyers at once.",
          "hold",
          STORES,
        ),
        {
          text: "Survive the rush when sales open.",
          covers: { rule: "scenario", scenario: "peak" },
        },
      ],
      concepts: ["flash traffic", "contention", "queues"],
      rubric: rubric(
        [
          "holds",
          "Explains how one seat can never be held or sold twice under contention.",
        ],
        [
          "rush",
          "Says how the system absorbs the opening rush: what queues, what is shed, what the buyer sees.",
        ],
      ),
      allowedComponents: [
        "cdn",
        "load_balancer",
        "app_service",
        "cache",
        "sql_db",
        "kv_store",
        "queue",
        "worker",
      ],
      requests: [
        { type: "seat_map", kind: "read", cacheable: true, share: 0.94 },
        { type: "hold", kind: "write", cacheable: false, share: 0.04 },
        { type: "buy", kind: "write", cacheable: false, share: 0.02 },
      ],
      ranges: {
        human: {
          rps: [6_000, 9_000],
          workingSetGb: [1, 5],
          hotKeySkew: [0.8, 0.95],
          storedGb: [10, 50],
          growthGbPerDay: [0.5, 2],
          p99Ms: [100, 160],
        },
        ai: {
          rps: [10_000, 14_000],
          workingSetGb: [2, 8],
          hotKeySkew: [0.8, 0.95],
          storedGb: [20, 80],
          growthGbPerDay: [1, 3],
          p99Ms: [70, 110],
        },
      },
      horizonDays: 30,
      shape: {
        nodes: [
          users,
          lb,
          app("api", "Stateless: maps from the cache, holds in the store."),
          cache(
            "maps",
            "Seat maps change rarely next to how often they're read.",
          ),
          kv("holds", "Each seat's hold, set only if free, with an expiry."),
          queue(
            "orders",
            "Purchases wait here so the rush doesn't reach payment.",
          ),
          workers("checkout", "Charge and confirm, retrying safely."),
          sql("sales", "Confirmed sales, the source of truth."),
        ],
        edges: [
          e("users", "lb", "seat_map", "hold", "buy"),
          e("lb", "api", "seat_map", "hold", "buy"),
          e("api", "maps", "seat_map"),
          e("api", "sales", "seat_map"),
          e("api", "holds", "hold"),
          e("api", "orders", "buy"),
          e("orders", "checkout", "buy"),
          e("checkout", "sales", "buy"),
        ],
      },
      lessons: [{ id: "no-cache", targets: "peak", without: "maps" }],
    },
    seeds: { human: 1 },
  },
  {
    family: {
      slug: "cup-live-scores",
      title: "Live sports scores",
      requirements: [
        served(
          "Show every live match's score, updated within seconds.",
          "scores",
          ["cdn", "cache", ...STORES],
          true,
        ),
        served("Post a score change from the stadium feed.", "update", STORES),
      ],
      concepts: ["CDN", "read fan-out", "cache freshness"],
      rubric: rubric(
        [
          "fresh",
          "Explains how a new score reaches viewers within seconds despite caching.",
        ],
        [
          "scale",
          "Says what carries the read load at its peak, and why the source isn't touched.",
        ],
      ),
      allowedComponents: [
        "cdn",
        "load_balancer",
        "app_service",
        "cache",
        "kv_store",
        "stream",
        "worker",
      ],
      requests: [
        { type: "scores", kind: "read", cacheable: true, share: 0.995 },
        { type: "update", kind: "write", cacheable: false, share: 0.005 },
      ],
      ranges: {
        human: {
          rps: [8_000, 14_000],
          workingSetGb: [1, 3],
          hotKeySkew: [0.8, 0.95],
          storedGb: [5, 20],
          growthGbPerDay: [0.1, 1],
          p99Ms: [120, 200],
        },
        ai: {
          rps: [40_000, 60_000],
          workingSetGb: [2, 5],
          hotKeySkew: [0.8, 0.95],
          storedGb: [10, 40],
          growthGbPerDay: [0.5, 2],
          p99Ms: [90, 140],
        },
      },
      horizonDays: 90,
      shape: {
        nodes: [
          users,
          {
            id: "cdn",
            kind: "cdn",
            config: { ttlSeconds: 5 },
            note: "Serves scores near viewers; a short TTL keeps them fresh.",
          },
          lb,
          app("api", "Stateless: reads scores, takes updates."),
          cache("scores", "The live scores, all in memory."),
          kv("matches", "Every match's score, the source of truth."),
        ],
        edges: [
          e("users", "cdn", "scores"),
          e("cdn", "lb", "scores"),
          e("users", "lb", "update"),
          e("lb", "api", "scores", "update"),
          e("api", "scores", "scores"),
          e("api", "matches", "scores", "update"),
        ],
      },
    },
    seeds: { human: 1, ai: 1 },
  },
  {
    family: {
      slug: "cup-ride-dispatch",
      title: "Ride-hailing dispatch",
      requirements: [
        served("Drivers report their location every few seconds.", "location", [
          "search_index",
          ...STORES,
        ]),
        served("Riders find the nearest available drivers.", "nearby", [
          "search_index",
        ]),
        served("A ride is assigned to one driver only.", "assign", ["sql_db"]),
      ],
      concepts: ["geospatial search", "write-heavy streams", "consistency"],
      rubric: rubric(
        [
          "nearby",
          "Explains how nearby drivers are found quickly as they move.",
        ],
        [
          "assign",
          "Says how one ride goes to one driver, even when two accept at once.",
        ],
      ),
      allowedComponents: [
        "load_balancer",
        "app_service",
        "cache",
        "sql_db",
        "kv_store",
        "stream",
        "worker",
        "search_index",
      ],
      requests: [
        { type: "location", kind: "write", cacheable: false, share: 0.8 },
        { type: "nearby", kind: "read", cacheable: false, share: 0.18 },
        { type: "assign", kind: "write", cacheable: false, share: 0.02 },
      ],
      ranges: {
        human: {
          rps: [3_000, 6_000],
          workingSetGb: [5, 20],
          hotKeySkew: [0.3, 0.6],
          storedGb: [50, 200],
          growthGbPerDay: [1, 5],
          p99Ms: [100, 180],
        },
        ai: {
          rps: [6_000, 9_000],
          workingSetGb: [10, 40],
          hotKeySkew: [0.3, 0.6],
          storedGb: [100, 300],
          growthGbPerDay: [2, 8],
          p99Ms: [70, 120],
        },
      },
      horizonDays: 90,
      shape: {
        nodes: [
          users,
          lb,
          app(
            "api",
            "Stateless: takes locations, answers searches, assigns rides.",
          ),
          stream(
            "locations",
            "Absorbs the location firehose, partitioned by area.",
          ),
          workers("indexers", "Keep each driver's place in the index current."),
          {
            id: "geo",
            kind: "search_index",
            config: { shards: 4, replicas: 1, zones: 3, regions: 1 },
            note: "Drivers by area, for nearby searches.",
          },
          sql(
            "rides",
            "Rides and their one driver, assigned in a transaction.",
          ),
        ],
        edges: [
          e("users", "lb", "location", "nearby", "assign"),
          e("lb", "api", "location", "nearby", "assign"),
          e("api", "locations", "location"),
          e("locations", "indexers", "location"),
          e("indexers", "geo", "location"),
          e("api", "geo", "nearby"),
          e("api", "rides", "assign"),
        ],
      },
    },
    seeds: { human: 3 },
  },
];
