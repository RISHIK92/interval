import type { ChannelId, ComponentKind, ProviderId } from "./catalog";

// P6-W36 (CANVAS-4; Q-P6-01): the public spec sheet, versioned. Every simulation is
// run against one version; numbers change only at season boundaries, with patch notes,
// like a competitive game's balance patches. v1.0's numbers are PROVISIONAL: Claude
// drafted them from typical real-world figures, for the owner to review before launch.

export type ComponentStats = {
  name: string;
  summary: string;
  // What one node handles per second at full use, in `unit`s; for a relational
  // database, reads (its writes go to the primary only, at `writeCapacity`).
  capacity: number;
  unit: string;
  writeCapacity?: number;
  // A request's time through the node when it isn't busy (queueing adds to it, W37).
  latencyMs: number;
  writeLatencyMs?: number;
  // The share of time one node is up; a zone or region failure takes all of its
  // nodes there (W37 models both by placement and failover).
  availability: number;
  costPerNodeHour: number; // USD
  // ADR-0050 [bytes]: what one node moves a second, in megabits; under version 2.0 its
  // utilization is the larger of requests and bytes against capacity.
  bandwidthMbps?: number;
  // Q-WD-31: numbers each problem sets in place of the sheet's (a provider's rate
  // limit and price per call), in words for the sheet.
  setByProblem?: string;
  // ADR-0050 §2, spec 2.1: a connection gateway's second resource, the concurrent
  // connections one node holds; its utilization is the larger of the two.
  connectionCapacity?: number;
};

// The simulator's own constants: part of the versioned spec, so a change to one is a
// balance patch with its notes, never a silent change to scores (CANVAS-4).
type EngineConstants = {
  hoursPerMonth: number;
  cdnContentChangeSeconds: number; // how often cacheable content changes, against a CDN's TTL
  maxCdnHitRate: number;
  maxCacheHitRate: number;
  cdnPointsOfPresence: number; // a CDN's servers: it never runs short in practice
  cacheMemoryCostPerGbHour: number; // USD, on top of a cache node's cost
  storageCostPerGbMonth: number; // USD, a relational database's provisioned storage
  kvStorageGbPerNode: number; // what one key-value node holds (replicas are copies)
  objectStoragePerGbMonth: number; // USD, billed on what's kept
};

// ADR-0050 §6: the engine's behaviours new since 1.0, each switched on by the version a
// design was drawn against (never by comparing version strings), with the constants
// it alone uses. A version without one simulates exactly as 1.0 did, for ever, since
// replays, disputes and appeals re-run old designs.
export type Features = {
  // [lag]: a queue or stream builds a backlog its consumers drain later, instead of
  // failing a spike or an outage beyond it; scenarios last `minutes`.
  lag?: { defaultScenarioMinutes: number };
  work?: true; // [work]: a request type's work units at a worker
  // [bytes]: payload bandwidth on the nodes that carry it, and egress billed per GB.
  bytes?: { cdnEgressPerGb: number; originEgressPerGb: number };
  // With the external provider: a request type its outage cuts off fails at once,
  // costing availability, not an unbounded p99 (a card network's outage refuses
  // payments; it doesn't hang them).
  failFast?: true;
  // ADR-0051: a request type names what must do its work (a provider, a worker); a path
  // that never reaches one doesn't serve the type.
  requires?: true;
  // Spec 2.1 (ADR-0050 stage 2, ADR-0052). [geo]: a nearby query asks only the shards
  // of the cells it covers.
  geo?: { cellsPerQuery: number };
  // The connection gateway: the problem's concurrent connections, push delivery, and a
  // reconnect storm when gateway servers are lost, spread over this window.
  gateway?: { reconnectWindowSeconds: number };
  // The coordination service: a quorum of members, a leader's write ceiling, a cap on
  // what it may hold, and the commit's extra latency across zones and regions.
  coordination?: {
    storageGb: number;
    crossZoneMs: number;
    crossRegionMs: number;
  };
  // [fanout]: one request becoming many deliveries, this many sent at once.
  fanout?: { parallelism: number };
  hot?: true; // [hot]: a request type's share on its busiest partition
  // [batch]: a worker's or app service's onward writes in batches; a worker waits at
  // most this long to fill one.
  batch?: { maxWaitSeconds: number };
  // ADR-0053: a problem may offer the external provider's provider and channel for the
  // player to pick, priced from this table for the problem's region; `seen` is the day
  // its list prices were read.
  providers?: { seen: string; prices: readonly ProviderPrice[] };
};

// ADR-0053: where a problem's users are, which sets what each provider charges.
type RegionId = "us" | "in";
export const REGION_NAMES: Record<RegionId, string> = {
  us: "the US",
  in: "India",
};

// One provider's list price for one channel in one region (docs/hld-provider-prices.md,
// PROVISIONAL). Only what the provider publishes: a figure it doesn't publish is null,
// and the simulator's own estimate (the external provider's latency and availability
// on the sheet) stands in, labelled as an estimate wherever it's shown.
export type ProviderPrice = {
  provider: ProviderId;
  channel: ChannelId;
  region: RegionId;
  // USD per unit; for a payment, the fixed part of its fee. Null: not offered or not
  // published there, so it can't be picked.
  perUnit: number | null;
  percent?: number; // a payment's fee, as a share of the ticket
  monthly?: number; // USD a month while it's picked (a WhatsApp number's subscription)
  perUser?: number; // USD a month per monthly active user (OneSignal's push)
  unit: string; // what one unit is: "SMS", "message", "email", "call", "payment"
  rateLimit: string | null; // as published; null: not published
  availability: number | null; // the published SLA; null: not published
  source: string;
  secondary?: true; // read from a search snippet of the provider's page
  note?: string;
};

const TWILIO_SLA = 0.9995; // twilio.com/en-us/legal/service-level-agreement/twilio-apis
const AWS_SLA = 0.999; // aws.amazon.com/pinpoint/sla (SES, End User Messaging), /messaging/sla (SNS)
const TWILIO_SMS = "https://www.twilio.com/en-us/sms/pricing/";
const TWILIO_VOICE = "https://www.twilio.com/en-us/voice/pricing/";
const TWILIO_WHATSAPP = "https://www.twilio.com/en-us/whatsapp/pricing";
const TWILIO_EMAIL = "https://www.twilio.com/en-us/products/email-api/pricing";
const AWS_SMS_CSV =
  "https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/business-applications/approved/documents/End-User-Messaging-SMS-Prices.ebc340b4d416d90832dd59629c4792b0deb6f8bc.csv";
const AWS_EUM = "https://aws.amazon.com/end-user-messaging/pricing/";
const AWS_SES = "https://aws.amazon.com/ses/pricing/";
const VONAGE = "https://dashboard.nexmo.com/download_pricing";
const STRIPE_LIMITS = "100 requests/s global, 25 per endpoint, 50 concurrent";
const AWS_VOICE_LIMITS = "20 calls a minute; 1 a second per number";

// docs/hld-provider-prices.md's summary table, US and India, seen 2026-11-24 at the FX
// there (1 USD = 92.92 INR = 0.91416 EUR). Voice is one billed minute a call.
const PROVIDER_PRICES: readonly ProviderPrice[] = [
  // Twilio (SendGrid for email).
  {
    provider: "twilio",
    channel: "sms",
    region: "us",
    perUnit: 0.0126,
    unit: "SMS",
    rateLimit: "short code 100 a second; toll-free 3 a second (secondary)",
    availability: TWILIO_SLA,
    source: `${TWILIO_SMS}us`,
    note: "$0.0083 plus the mean AT&T, T-Mobile and Verizon carrier fee.",
  },
  {
    provider: "twilio",
    channel: "sms",
    region: "in",
    perUnit: 0.0832,
    unit: "SMS",
    rateLimit: null,
    availability: TWILIO_SLA,
    source: `${TWILIO_SMS}in`,
    note: "₹7.73; no separate domestic rate is listed.",
  },
  {
    provider: "twilio",
    channel: "whatsapp",
    region: "us",
    perUnit: 0.0076,
    unit: "message",
    rateLimit: null,
    availability: TWILIO_SLA,
    source: TWILIO_WHATSAPP,
    note: "$0.005 plus Meta's $0.002563 authentication rate.",
  },
  {
    provider: "twilio",
    channel: "whatsapp",
    region: "in",
    perUnit: 0.0062,
    unit: "message",
    rateLimit: null,
    availability: TWILIO_SLA,
    source: TWILIO_WHATSAPP,
    note: "$0.005 plus Meta's $0.001183 authentication rate.",
  },
  ...(["us", "in"] as const).map((region): ProviderPrice => ({
    provider: "twilio",
    channel: "email",
    region,
    perUnit: 0.0004,
    unit: "email",
    rateLimit: null,
    availability: TWILIO_SLA,
    source: TWILIO_EMAIL,
    secondary: true,
    note: "SendGrid Essentials, $19.95 a month for 50,000 emails, averaged; any region.",
  })),
  {
    provider: "twilio",
    channel: "voice",
    region: "us",
    perUnit: 0.014,
    unit: "call",
    rateLimit: "1 call a second per account (5 self-serve, secondary)",
    availability: TWILIO_SLA,
    source: `${TWILIO_VOICE}us`,
  },
  {
    provider: "twilio",
    channel: "voice",
    region: "in",
    perUnit: 0.0496,
    unit: "call",
    rateLimit: "1 call a second per account (5 self-serve, secondary)",
    availability: TWILIO_SLA,
    source: `${TWILIO_VOICE}in`,
    note: "₹4.61 a minute to a mobile.",
  },
  // MSG91.
  {
    provider: "msg91",
    channel: "sms",
    region: "us",
    perUnit: 0.0078,
    unit: "SMS",
    rateLimit: null,
    availability: null,
    source: "https://msg91.com/us/pricing/sms",
  },
  {
    provider: "msg91",
    channel: "sms",
    region: "in",
    perUnit: 0.0018,
    unit: "SMS",
    rateLimit: null,
    availability: null,
    source: "https://msg91.com/in/pricing/sms",
    note: "₹0.17, the 60,000 slab, before 18% GST.",
  },
  {
    provider: "msg91",
    channel: "whatsapp",
    region: "us",
    perUnit: 0.0026,
    monthly: 7,
    unit: "message",
    rateLimit: null,
    availability: null,
    source: "https://msg91.com/us/pricing/whatsapp",
    note: "Meta's rate, assumed passed through unchanged, plus $7 a month a number.",
  },
  {
    provider: "msg91",
    channel: "whatsapp",
    region: "in",
    perUnit: 0.0012,
    monthly: 5.38,
    unit: "message",
    rateLimit: null,
    availability: null,
    source: "https://msg91.com/in/pricing/whatsapp",
    note: "Meta's ₹0.110, assumed passed through unchanged, plus ₹500 a month a number.",
  },
  {
    provider: "msg91",
    channel: "email",
    region: "us",
    perUnit: null,
    unit: "email",
    rateLimit: null,
    availability: null,
    source: "https://msg91.com/us/pricing/sms",
    note: "No US email price is listed.",
  },
  {
    provider: "msg91",
    channel: "email",
    region: "in",
    perUnit: 0.00022,
    unit: "email",
    rateLimit: null,
    availability: null,
    source: "https://msg91.com/in/pricing/email",
    note: "₹2,000 a month for 100,000 (Starter), averaged.",
  },
  {
    provider: "msg91",
    channel: "voice",
    region: "us",
    perUnit: null,
    unit: "call",
    rateLimit: null,
    availability: null,
    source: "https://msg91.com/in/pricing/voice",
    note: "No US voice price is listed.",
  },
  {
    provider: "msg91",
    channel: "voice",
    region: "in",
    perUnit: 0.0054,
    unit: "call",
    rateLimit: null,
    availability: null,
    source: "https://msg91.com/in/pricing/voice",
    note: "₹0.50 a minute, the landline rate: a mobile rate isn't listed.",
  },
  // Amazon: End User Messaging (SMS, voice, WhatsApp) and SES (email).
  {
    provider: "amazon",
    channel: "sms",
    region: "us",
    perUnit: 0.01195,
    unit: "SMS",
    rateLimit:
      "short code 100 a second, toll-free 3, 10DLC per campaign; $1 a month of SMS by default",
    availability: AWS_SLA,
    source: AWS_SMS_CSV,
    note: "$0.00774 plus a $0.00421 carrier fee.",
  },
  {
    provider: "amazon",
    channel: "sms",
    region: "in",
    perUnit: 0.004,
    unit: "SMS",
    rateLimit: "sender ID 10 a second",
    availability: AWS_SLA,
    source: AWS_SMS_CSV,
    note: "₹0.37, the local route, which needs India DLT registration; the default international route is $0.071.",
  },
  {
    provider: "amazon",
    channel: "whatsapp",
    region: "us",
    perUnit: 0.0076,
    unit: "message",
    rateLimit: null,
    availability: null,
    source: AWS_EUM,
    note: "$0.005 plus Meta's $0.002563.",
  },
  {
    provider: "amazon",
    channel: "whatsapp",
    region: "in",
    perUnit: 0.0032,
    unit: "message",
    rateLimit: null,
    availability: null,
    source: AWS_EUM,
    note: "$0.002 plus Meta's $0.001183.",
  },
  ...(["us", "in"] as const).map((region): ProviderPrice => ({
    provider: "amazon",
    channel: "email",
    region,
    perUnit: 0.0001,
    unit: "email",
    rateLimit: "sandbox 1 a second and 200 a day; production set per account",
    availability: AWS_SLA,
    source: AWS_SES,
    note: "SES, $0.10 per 1,000, pay as you go; any region.",
  })),
  {
    provider: "amazon",
    channel: "voice",
    region: "us",
    perUnit: 0.013,
    unit: "call",
    rateLimit: AWS_VOICE_LIMITS,
    availability: AWS_SLA,
    source: AWS_EUM,
  },
  {
    provider: "amazon",
    channel: "voice",
    region: "in",
    perUnit: 0.038,
    unit: "call",
    rateLimit: AWS_VOICE_LIMITS,
    availability: AWS_SLA,
    source: AWS_EUM,
    note: "₹3.53 a minute.",
  },
  // Vonage: its downloadable price sheet, in EUR.
  {
    provider: "vonage",
    channel: "sms",
    region: "us",
    perUnit: 0.0112,
    unit: "SMS",
    rateLimit: null,
    availability: null,
    source: VONAGE,
    note: "€0.0102; US carrier fees come on top, and their amounts aren't published.",
  },
  {
    provider: "vonage",
    channel: "sms",
    region: "in",
    perUnit: 0.086,
    unit: "SMS",
    rateLimit: null,
    availability: null,
    source: VONAGE,
    note: "€0.0786.",
  },
  ...(["us", "in"] as const).flatMap((region): ProviderPrice[] => [
    {
      provider: "vonage",
      channel: "whatsapp",
      region,
      perUnit: null,
      unit: "message",
      rateLimit: null,
      availability: null,
      source: VONAGE,
      note: "Its WhatsApp prices couldn't be read (the page refused an automated read).",
    },
    {
      provider: "vonage",
      channel: "email",
      region,
      perUnit: null,
      unit: "email",
      rateLimit: null,
      availability: null,
      source: VONAGE,
      note: "No email API is offered.",
    },
  ]),
  {
    provider: "vonage",
    channel: "voice",
    region: "us",
    perUnit: 0.0144,
    unit: "call",
    rateLimit: null,
    availability: null,
    source: VONAGE,
    note: "€0.01314 a minute.",
  },
  {
    provider: "vonage",
    channel: "voice",
    region: "in",
    perUnit: 0.0748,
    unit: "call",
    rateLimit: null,
    availability: null,
    source: VONAGE,
    note: "€0.06839 a minute.",
  },
  // Push (owner, 2026-11-24): the same price wherever the users are.
  ...(["us", "in"] as const).flatMap((region): ProviderPrice[] => [
    {
      provider: "fcm",
      channel: "push",
      region,
      perUnit: 0,
      unit: "notification",
      rateLimit: "600,000 messages a minute per project (default)",
      availability: null,
      source: "https://firebase.google.com/pricing",
      note: "No cost. Reaches Android, and Apple devices through APNs.",
    },
    {
      provider: "apns",
      channel: "push",
      region,
      perUnit: 0,
      unit: "notification",
      rateLimit: null,
      availability: null,
      source: "https://developer.apple.com/programs/",
      note: "No charge per notification; Apple devices only. The $99 a year developer membership isn't counted.",
    },
    {
      provider: "amazon",
      channel: "push",
      region,
      perUnit: 0.000001,
      unit: "notification",
      rateLimit: null,
      availability: AWS_SLA,
      source: "https://aws.amazon.com/sns/pricing/",
      secondary: true,
      note: "SNS mobile push: $0.50 per million publishes and $0.50 per million deliveries; the first million free a month isn't counted.",
    },
    {
      provider: "onesignal",
      channel: "push",
      region,
      perUnit: 0,
      monthly: 19,
      perUser: 0.012,
      unit: "notification",
      rateLimit: null,
      availability: null,
      source: "https://onesignal.com/pricing",
      note: "Growth plan: from $19 a month, plus $0.012 per monthly active user, sends unlimited.",
    },
  ]),
  // Payments: a percentage of the ticket plus a fixed fee, for a domestic card.
  {
    provider: "stripe",
    channel: "card",
    region: "us",
    perUnit: 0.3,
    percent: 0.029,
    unit: "payment",
    rateLimit: STRIPE_LIMITS,
    availability: null,
    source: "https://stripe.com/us/pricing",
    secondary: true,
    note: "International cards 1.5% more, and 1% more with currency conversion.",
  },
  {
    provider: "stripe",
    channel: "card",
    region: "in",
    perUnit: 0,
    percent: 0.02,
    unit: "payment",
    rateLimit: STRIPE_LIMITS,
    availability: null,
    source: "https://stripe.com/in/pricing",
    note: "No fixed fee; international cards 3%.",
  },
  {
    provider: "razorpay",
    channel: "card",
    region: "us",
    perUnit: null,
    unit: "payment",
    rateLimit: null,
    availability: null,
    source: "https://razorpay.com/pricing/",
    note: "Razorpay lists prices for Indian businesses only.",
  },
  {
    provider: "razorpay",
    channel: "card",
    region: "in",
    perUnit: 0,
    percent: 0.0236,
    unit: "payment",
    rateLimit: null,
    availability: null,
    source: "https://razorpay.com/pricing/",
    note: "2%, plus 18% GST on the fee; international cards up to 3%.",
  },
  {
    provider: "paypal",
    channel: "card",
    region: "us",
    perUnit: 0.49,
    percent: 0.0299,
    unit: "payment",
    rateLimit: null,
    availability: null,
    source: "https://www.paypal.com/us/webapps/mpp/merchant-fees",
    secondary: true,
    note: "The standard card rate; international cards 1.5% more.",
  },
  {
    provider: "paypal",
    channel: "card",
    region: "in",
    perUnit: null,
    unit: "payment",
    rateLimit: null,
    availability: null,
    source: "https://www.paypal.com/in/webapps/mpp/merchant-fees",
    secondary: true,
    note: "Only its international rate is published, 4.40% plus a fixed fee by currency that couldn't be read.",
  },
];

export type SpecVersion = {
  version: string;
  date: string; // ISO day it took effect: a season boundary (CANVAS-4), or ADR-0055's day
  provisional: boolean;
  // The kinds this version has: a design using any other is refused.
  components: Partial<Record<ComponentKind, ComponentStats>>;
  features: Features;
  notes: string[]; // the patch notes: what changed from the version before
  engine: EngineConstants;
};

const V1_0 = {
  version: "1.0",
  date: "2026-11-14",
  provisional: true,
  features: {},
  notes: [
    "The first spec sheet: 12 components with their capacity, latency, availability and cost.",
  ],
  engine: {
    hoursPerMonth: 730,
    cdnContentChangeSeconds: 600,
    maxCdnHitRate: 0.95,
    maxCacheHitRate: 0.99,
    cdnPointsOfPresence: 20,
    cacheMemoryCostPerGbHour: 0.005,
    storageCostPerGbMonth: 0.115,
    kvStorageGbPerNode: 1_000,
    objectStoragePerGbMonth: 0.023,
  },
  components: {
    client: {
      name: "Client",
      summary:
        "The problem's users: where its traffic starts. Exactly one per design.",
      capacity: 0,
      unit: "requests/s",
      latencyMs: 0,
      availability: 1,
      costPerNodeHour: 0,
    },
    cdn: {
      name: "CDN",
      summary:
        "Serves cacheable responses from the edge; misses go to its origin. Its hit rate follows the TTL against how often content changes.",
      capacity: 100_000,
      unit: "requests/s per point of presence",
      latencyMs: 15,
      availability: 0.9999,
      costPerNodeHour: 0.08,
    },
    load_balancer: {
      name: "Load balancer",
      summary:
        "Spreads requests across the nodes behind it, in every zone it spans.",
      capacity: 50_000,
      unit: "requests/s",
      latencyMs: 1,
      availability: 0.9999,
      costPerNodeHour: 0.025,
    },
    app_service: {
      name: "App service",
      summary: "Stateless application servers. Scale by adding nodes.",
      capacity: 1_000,
      unit: "requests/s per node",
      latencyMs: 20,
      availability: 0.999,
      costPerNodeHour: 0.1,
    },
    cache: {
      name: "Cache",
      summary:
        "An in-memory key-value cache. Its hit rate follows its memory against the problem's working set and hot-key skew.",
      capacity: 100_000,
      unit: "operations/s per node",
      latencyMs: 1,
      availability: 0.999,
      costPerNodeHour: 0.2,
    },
    sql_db: {
      name: "Relational database",
      summary:
        "A primary that takes every write, and read replicas. Failover decides what a primary's or zone's failure costs.",
      capacity: 10_000,
      unit: "reads/s per instance",
      writeCapacity: 2_000,
      latencyMs: 5,
      writeLatencyMs: 10,
      availability: 0.999,
      costPerNodeHour: 0.5,
    },
    kv_store: {
      name: "Key-value store",
      summary:
        "A partitioned NoSQL store that scales by nodes; replication keeps data through node failures.",
      capacity: 20_000,
      unit: "operations/s per node",
      latencyMs: 3,
      availability: 0.999,
      costPerNodeHour: 0.25,
    },
    queue: {
      name: "Message queue",
      summary:
        "Decouples producers from consumers; it absorbs bursts the workers then drain.",
      capacity: 10_000,
      unit: "messages/s per partition",
      latencyMs: 5,
      availability: 0.9995,
      costPerNodeHour: 0.05,
    },
    worker: {
      name: "Worker service",
      summary: "Background workers that consume a queue or stream.",
      capacity: 200,
      unit: "jobs/s per node",
      latencyMs: 50,
      availability: 0.999,
      costPerNodeHour: 0.1,
    },
    object_storage: {
      name: "Object storage",
      summary:
        "Durable storage for files and blobs, effectively unlimited; slower than a database.",
      capacity: 100_000,
      unit: "requests/s",
      latencyMs: 50,
      availability: 0.9999,
      costPerNodeHour: 0.03,
    },
    search_index: {
      name: "Search index",
      summary:
        "Full-text and filtered search. Shards spread the data; replicas add read capacity and survive failures.",
      capacity: 2_000,
      unit: "queries/s per shard replica",
      latencyMs: 30,
      availability: 0.999,
      costPerNodeHour: 0.3,
    },
    stream: {
      name: "Stream processor",
      summary:
        "An ordered, replayable log (Kafka-like), read by consumers at their own pace.",
      capacity: 50_000,
      unit: "events/s per partition",
      latencyMs: 10,
      availability: 0.9995,
      costPerNodeHour: 0.08,
    },
  },
} satisfies SpecVersion;

// ADR-0055 (owner, 2026-11-26): v2.0 takes effect now, with v2.1, instead of at Q-WD-31's
// monthly boundary (2026-12-01). Before it, no match or practice problem is drawn on 2.0.
export const SPEC_V2_FROM = "2026-11-26";

// ADR-0050 stage 1 (§5, PROVISIONAL like 1.0): the external provider, backlog and lag,
// work units, and payload bandwidth with egress. Every 1.0 number is unchanged.
const V2_0: SpecVersion = {
  version: "2.0",
  date: SPEC_V2_FROM,
  provisional: true,
  features: {
    lag: { defaultScenarioMinutes: 15 },
    work: true,
    bytes: { cdnEgressPerGb: 0.02, originEgressPerGb: 0.09 },
    failFast: true,
    requires: true,
    providers: { seen: "2026-11-24", prices: PROVIDER_PRICES },
  },
  notes: [
    "New component: the external provider, a third party (card network, SMS, customers' endpoints, the open web) at the problem's rate limit and price per call. It can't be scaled, and it can go down. Used by one-time code sign-in, webhook delivery, payment processing and the web crawler.",
    "Queues and streams now hold a backlog: when their consumers fall behind, or the provider behind them is down, work waits and drains afterwards. It counts as served when it's done within the request's completion target and the queue's retention; streams gain a retention setting. Used by one-time code sign-in, webhook delivery, payment processing, the web crawler, image resizing and video streaming.",
    "Work units: a job can cost a worker many times a simple one (a transcode against a counter). Used by image resizing, video streaming and the web crawler.",
    "Bytes: requests carry a payload. App services (1,000 Mbps a node) and load balancers (10,000 Mbps) fill on bytes as well as requests, and bytes served are billed: $0.02 a GB from a CDN, $0.09 from anything else. Used by image resizing, video streaming and file sync.",
    "A request type an outage cuts off (the provider is down) now fails at once: it counts against what's served, not as an unbounded p99.",
    "A request type says what must do its work: a code isn't sent until it reaches the SMS provider, and an upload isn't transcoded until it reaches a worker. A design that leaves that out serves none of it, however cheap.",
    "Pick your provider (amended on 24 Nov 2026, before 2.0 took effect): where a problem offers it, you pick the external provider's provider and channel. Twilio, MSG91, Amazon or Vonage, by SMS, WhatsApp, email or a voice call; Stripe, Razorpay or PayPal for card payments. Each is priced at its real list price in the problem's region (seen 24 Nov 2026, provisional), and one not offered there can't be picked. A payment's fee is its percentage of the problem's average ticket plus its fixed fee, paid apart from the infrastructure budget and held to the problem's target for fees per payment. Used by one-time code sign-in and payment processing. The sheet also prices push (FCM, APNs, Amazon, OneSignal), which only 2.1's notification service offers.",
    "Every version 1.0 number is unchanged, and so is every 1.0 family's result: they stay on 1.0.",
    "Brought forward (owner, 26 Nov 2026): 2.0 takes effect on 26 Nov 2026, with 2.1, instead of at the 1 Dec 2026 season boundary.",
  ],
  engine: V1_0.engine,
  components: {
    ...V1_0.components,
    load_balancer: { ...V1_0.components.load_balancer, bandwidthMbps: 10_000 },
    app_service: { ...V1_0.components.app_service, bandwidthMbps: 1_000 },
    external_api: {
      name: "External provider",
      summary:
        "A third party the design calls but can't scale: a card network, an SMS or email provider, customers' webhook endpoints, the open web. It has a rate limit and a price per call, and it can go down.",
      capacity: 0,
      unit: "calls/s",
      latencyMs: 250,
      availability: 0.995,
      costPerNodeHour: 0,
      setByProblem:
        "each problem's rate limit, and its price per call or the picked provider's",
    },
  },
};

// ADR-0055 (owner, 2026-11-26): v2.1 takes effect the same day as v2.0, instead of at
// the monthly boundary after it (Q-WD-31: 2027-01-01).
export const SPEC_V21_FROM = "2026-11-26";

// ADR-0050 stage 2 (§2, §3, §5, PROVISIONAL like the rest), with ADR-0052's rules: the
// geo index, the connection gateway and the coordination service; fan-out, hot
// partitions and batching. Every 1.0 and 2.0 number is unchanged.
const V2_1: SpecVersion = {
  version: "2.1",
  date: SPEC_V21_FROM,
  provisional: true,
  features: {
    ...V2_0.features,
    geo: { cellsPerQuery: 3 },
    gateway: { reconnectWindowSeconds: 30 },
    coordination: { storageGb: 8, crossZoneMs: 2, crossRegionMs: 70 },
    fanout: { parallelism: 50 },
    hot: true,
    batch: { maxWaitSeconds: 5 },
  },
  notes: [
    "New component: the geo index, an in-memory index of where things are. A nearby query asks only the 3 shards its cells fall in, so shards add query capacity, unlike a search index's. It holds positions, not history. Used by nearby places and food delivery tracking.",
    "New component: the connection gateway, holding clients' persistent connections (50,000 a node) and pushing messages down them (20,000 a second a node). A gateway that loses servers sends their clients back to connect again within 30 seconds: a reconnect storm. Used by presence, the collaborative editor, food delivery tracking, feature flags and the notification service.",
    "New component: the coordination service, a 3, 5 or 7 member consensus cluster for leases, leader election and ID blocks. It's up while a majority of its members is, its leader commits about 4,000 writes a second at 3 members (fewer with more), and it holds at most 8 GB. Used by the unique ID generator and the scheduled jobs service.",
    "Fan-out: one request can become many deliveries (a post to its followers, a campaign to a segment). Everything after the first worker behind a queue, or the first app service when there's none, carries that many times the load, and the deliveries go out 50 at a time.",
    "Hot partitions: a request type can put a share of its load on one partition of a key-value store, stream, queue or geo index (a viral post, a big merchant). That partition can overload while the rest idle; a cache in front takes hot reads, and batching takes hot writes.",
    "Batching: workers and app services gain a batch size. A worker's or app service's onward writes go in batches of that many, and a worker waits at most 5 seconds to fill one. An app service's batch is an ID block it hands out without asking again.",
    "Every version 1.0 and 2.0 number is unchanged, and so is every 1.0 and 2.0 family's result: they stay on their versions.",
    "Brought forward (owner, 26 Nov 2026): 2.1 takes effect on 26 Nov 2026, with 2.0, instead of at the 1 Jan 2027 season boundary.",
  ],
  engine: V1_0.engine,
  components: {
    ...V2_0.components,
    geo_index: {
      name: "Geo index",
      summary:
        "An in-memory index of where things are (geohash, quadtree or S2 cells). A nearby query asks only the shards of the cells it covers; replicas add query capacity and survive failures. It keeps positions, never history.",
      capacity: 5_000,
      unit: "queries/s per shard replica",
      writeCapacity: 40_000,
      latencyMs: 5,
      writeLatencyMs: 2,
      availability: 0.999,
      costPerNodeHour: 0.2,
    },
    connection_gateway: {
      name: "Connection gateway",
      summary:
        "Holds clients' persistent connections (WebSocket or long-poll) and pushes messages down them. Fills on connections or on messages, whichever is nearer its limit.",
      capacity: 20_000,
      unit: "messages/s per node",
      connectionCapacity: 50_000,
      latencyMs: 2,
      availability: 0.999,
      costPerNodeHour: 0.15,
      bandwidthMbps: 1_000,
    },
    coordination: {
      name: "Coordination service",
      summary:
        "A small consensus cluster (etcd or ZooKeeper-like) for leases, leader election, locks and ID blocks. Up while a majority of its members is; every write commits through its leader.",
      capacity: 20_000,
      unit: "reads/s per member",
      writeCapacity: 4_000,
      latencyMs: 2,
      writeLatencyMs: 8,
      availability: 0.999,
      costPerNodeHour: 0.2,
    },
  },
};

// Every version ever published, oldest first; a design names the one it was drawn
// against.
export const SPEC_VERSIONS: readonly SpecVersion[] = [V1_0, V2_0, V2_1];
// The newest version, whatever is in effect today: the sheet and the canvas's names.
export const LATEST_SPEC = V2_1;

export function specVersion(version: string): SpecVersion | null {
  return SPEC_VERSIONS.find((s) => s.version === version) ?? null;
}

// A version is in effect from its day on (UTC days).
export function specInEffect(version: string, now: Date): boolean {
  const spec = specVersion(version);
  return spec !== null && spec.date <= now.toISOString().slice(0, 10);
}

// A kind's numbers in a version; the design was refused if the version lacks the kind.
export function statsOf(
  spec: SpecVersion,
  kind: ComponentKind,
): ComponentStats {
  const stats = spec.components[kind];
  if (stats === undefined)
    throw new Error(`spec ${spec.version} has no ${kind}`);
  return stats;
}
