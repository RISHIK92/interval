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
    lesson: { id: "no-cache", targets: "peak", without: "cache" },
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
    lesson: { id: "no-cache", targets: "peak", without: "suggestions" },
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
    lesson: { id: "no-cache", targets: "peak", without: "catalog" },
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
    lesson: { id: "no-cache", targets: "peak", without: "pages" },
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
    lesson: { id: "no-cache", targets: "peak", without: "rooms" },
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
    lesson: {
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
    practiceSeeds: [1],
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
      lesson: { id: "no-cache", targets: "peak", without: "maps" },
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
