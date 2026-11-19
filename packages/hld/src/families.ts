import type { DesignEdge, DesignNode } from "./design";
import type { Family } from "./family";

// P6-W40 (HLDQ-2; Q-P6-04): the 8 families, PROVISIONAL until the owner reviews them.
// Each request type's write rate stays within a relational primary's 2,000 writes a
// second at three times its baseline, and each family's traffic within what its shape
// can carry, so the sizer can find a reference design.

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

const rubric = (...criteria: [string, string][]) =>
  criteria.map(([id, criterion]) => ({ id, criterion, weight: 1 }));

export const FAMILIES: readonly Family[] = [
  {
    slug: "url-shortener",
    title: "URL shortener",
    requirements: [
      "Create a short code for a long URL.",
      "Redirect a short code to its URL, fast.",
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
    title: "Photo sharing",
    requirements: [
      "Upload a photo with its caption.",
      "View photos, mostly recent and popular ones.",
      "Load a photo's details: caption, owner and likes.",
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
    title: "News feed",
    requirements: [
      "Post an update to your followers.",
      "Read your feed: the newest posts from everyone you follow.",
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
    title: "Chat",
    requirements: [
      "Send a message to a conversation.",
      "Deliver it to the recipient, even if they're offline.",
      "Load a conversation's recent history.",
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
    title: "Search and autocomplete",
    requirements: [
      "Suggest completions as a user types.",
      "Search documents by text and filters.",
      "Index new and changed documents within a minute.",
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
    title: "Checkout",
    requirements: [
      "Browse products and their prices.",
      "Place an order, charged exactly once.",
      "Check an order's status.",
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
    title: "Metrics ingestion",
    requirements: [
      "Accept metric points from many services.",
      "Query recent points for a dashboard.",
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
    title: "Rate limiter",
    requirements: [
      "Allow or refuse each API request against its client's limits, adding very little latency.",
      "Change a client's limits without a restart.",
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
];

// P6-W44 (§6.4, HLDQ-3, Q-P6-08): the cup problems, hand-written, PROVISIONAL until the
// owner reviews them. Validated as any variant, never in the match pool or practice: the
// admin picks them for a tournament's rounds, and they're retired once used. Each keeps
// one seed for each league it validates in (`seeds`), checked by the tests.
export const CUPS: readonly {
  family: Family;
  seeds: Partial<Record<"human" | "ai", number>>;
}[] = [
  {
    family: {
      slug: "cup-concert-tickets",
      title: "Concert ticket sale",
      requirements: [
        "Show a concert's seat map and prices.",
        "Hold a seat for a buyer for a few minutes, never for two buyers at once.",
        "Survive the rush when sales open.",
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
      practiceSeeds: [],
      lesson: { id: "no-cache", targets: "peak", without: "maps" },
    },
    seeds: { human: 1 },
  },
  {
    family: {
      slug: "cup-live-scores",
      title: "Live sports scores",
      requirements: [
        "Show every live match's score, updated within seconds.",
        "Post a score change from the stadium feed.",
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
      practiceSeeds: [],
    },
    seeds: { human: 1, ai: 1 },
  },
  {
    family: {
      slug: "cup-ride-dispatch",
      title: "Ride-hailing dispatch",
      requirements: [
        "Drivers report their location every few seconds.",
        "Riders find the nearest available drivers.",
        "A ride is assigned to one driver only.",
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
      practiceSeeds: [],
    },
    seeds: { human: 3 },
  },
];
