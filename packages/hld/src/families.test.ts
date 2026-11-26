import { describe, expect, test } from "vitest";
import { CUPS, FAMILIES } from "./families";
import { drawVariant, matchProblem, variantSpec } from "./match";
import {
  buildPool,
  type Family,
  familySpec,
  matchFamilies,
  POOL_SIZE,
  poolSplit,
  practiceFamilies,
  SPLIT_AT,
  validate,
  variant,
} from "./family";
import { POOL } from "./pool";
import { practiceProblems } from "./practice";
import { removeNode } from "./edit";
import { simulate } from "./simulate";
import { SPEC_V2_FROM, SPEC_V21_FROM, specInEffect } from "./spec";

// P6-W40 (HLDQ-2, HLDQ-3; Q-P6-04): the families, their variants and the pool.
const pool = POOL;
// The last second before, and the first of, the day spec 2.0 takes effect, and 2.1's
// (ADR-0055: the same day, 2026-11-26).
const FROM = new Date(`${SPEC_V2_FROM}T00:00:00Z`);
const BEFORE = new Date(FROM.getTime() - 1000);
const FROM_21 = new Date(`${SPEC_V21_FROM}T00:00:00Z`);
const BEFORE_21 = new Date(FROM_21.getTime() - 1000);

test("there are 31 families, each with its own slug", () => {
  expect(new Set(FAMILIES.map((f) => f.slug)).size).toBe(31);
});

// CANVAS-3's regression check for variants: an engine or family change that breaks one
// fails here; `pnpm --filter @interval/hld data` rebuilds the file. It simulates every
// variant: about 2 s alone, but past the 5 s default when a 4-CPU machine runs all suites.
test("pool.ts is what the families and the engine make now", () => {
  expect(buildPool(FAMILIES)).toEqual(pool);
}, 30_000);

describe.each(matchFamilies(FAMILIES))("$slug", (family) => {
  test("each battle mode has a full pool of valid seeds, none of them for practice", () => {
    for (const battleMode of ["human", "ai"] as const) {
      const seeds = pool[family.slug]?.[battleMode] ?? [];
      expect(seeds).toHaveLength(POOL_SIZE);
      for (const seed of seeds) {
        expect(family.practiceSeeds ?? []).not.toContain(seed);
        expect(validate(variant(family, battleMode, seed))).toEqual([]);
      }
    }
  });
});

describe.each(FAMILIES)("$slug", (family) => {
  test("its practice seed is valid", () => {
    for (const seed of family.practiceSeeds ?? [])
      expect(validate(variant(family, "human", seed))).toEqual([]);
  });

  test("a seed always makes the same variant", () => {
    expect(variant(family, "ai", 7)).toEqual(variant(family, "ai", 7));
  });

  test("the AI mode is harder: less budget headroom, a lost region, more traffic", () => {
    const rps = (p: { traffic: { requests: { rps: number }[] } }) =>
      p.traffic.requests.reduce((a, r) => a + r.rps, 0);
    const headroom = (battleMode: "human" | "ai", seed: number) => {
      const v = variant(family, battleMode, seed);
      return (
        v.problem.budgetPerMonth / simulate(v.problem, v.reference).costPerMonth
      );
    };
    for (const seed of [3, 4, 5]) {
      expect(headroom("ai", seed)).toBeLessThan(headroom("human", seed));
      const ai = variant(family, "ai", seed).problem;
      const human = variant(family, "human", seed).problem;
      expect(ai.scenarios.map((s) => s.id)).toContain("region");
      expect(human.scenarios.map((s) => s.id)).not.toContain("region");
    }
    const mean = (battleMode: "human" | "ai") =>
      [3, 4, 5, 6, 7].reduce(
        (a, seed) => a + rps(variant(family, battleMode, seed).problem),
        0,
      );
    expect(mean("ai")).toBeGreaterThan(mean("human"));
  });

  test("different seeds make different problems", () => {
    expect(variant(family, "human", 3).problem.traffic).not.toEqual(
      variant(family, "human", 4).problem.traffic,
    );
  });
});

test("practice is each practice family's practice seed, under the family's slug", () => {
  expect(practiceProblems(FROM_21).map((p) => p.slug)).toEqual(
    practiceFamilies(FAMILIES).map((f) => f.slug),
  );
  expect(practiceProblems(FROM_21)[0]?.requirements.at(-1)).toMatch(
    /^A budget of \$/,
  );
});

// ADR-0050 §1, Q-WD-31: the HLD practice pool, split from the battle pool once the
// battle pool keeps at least SPLIT_AT families.
describe("the pool split", () => {
  const base = FAMILIES[0];
  if (base === undefined) throw new Error("no families");
  const made = (battle: number, practice: number): Family[] => [
    ...Array.from({ length: battle }, (_, i): Family => ({
      ...base,
      slug: `b${String(i)}`,
      pool: "battle",
    })),
    ...Array.from({ length: practice }, (_, i): Family => ({
      ...base,
      slug: `p${String(i)}`,
      pool: "practice",
      practiceSeeds: [1],
    })),
  ];

  test("below the threshold every family is in practice and in matches, as before", () => {
    const families = made(SPLIT_AT - 1, 4);
    expect(poolSplit(families)).toBe(false);
    expect(practiceFamilies(families)).toEqual(families);
    expect(matchFamilies(families)).toEqual(families);
  });

  test("at the threshold practice has only practice families and matches only battle ones", () => {
    const families = made(SPLIT_AT, 4);
    expect(poolSplit(families)).toBe(true);
    expect(practiceFamilies(families).map((f) => f.slug)).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
    ]);
    expect(matchFamilies(families).every((f) => f.pool === "battle")).toBe(
      true,
    );
  });

  test("is on today: stage 0 brings the battle pool to six, stage 1 to ten, stage 2 to seventeen", () => {
    expect(poolSplit(FAMILIES)).toBe(true);
    expect(matchFamilies(FAMILIES).map((f) => f.slug)).toEqual([
      "chat",
      "checkout",
      "metrics-ingestion",
      "rate-limiter",
      "qa-forum",
      "product-search",
      "file-sync",
      "video-on-demand",
      "payment-processing",
      "web-crawler",
      "food-delivery-tracking",
      "collaborative-editor",
      "notification-service",
      "job-scheduler",
      "feature-flags",
      "like-counters",
      "ad-click-aggregation",
    ]);
  });

  // A practice family's shape and lesson have been seen with no clock: it never moves
  // back. Add to this list; never take from it.
  test.each([
    "url-shortener",
    "photo-sharing",
    "news-feed",
    "search-autocomplete",
    "hotel-booking",
    "distributed-cache",
    "otp-login",
    "webhook-delivery",
    "image-resizer",
    "nearby-places",
    "presence",
    "id-generator",
    "wallet-ledger",
    "feature-store",
  ])("%s stays a practice family, never drawn for a match", (slug) => {
    const family = FAMILIES.find((f) => f.slug === slug);
    expect(family?.pool).toBe("practice");
    let n = 0;
    const random = () => (n = (n * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 500; i++)
      expect(drawVariant("human", random, new Set(), FROM_21).family).not.toBe(
        slug,
      );
    expect(practiceProblems(FROM_21).some((p) => p.slug === slug)).toBe(true);
  });

  // ADR-0050 §1: a practice family has no battle seeds; those written before 2.1 keep
  // theirs, so the matches of families that moved to practice still rebuild.
  test("a practice family made on 2.1 has no battle seeds", () => {
    for (const f of FAMILIES.filter(
      (x) => x.pool === "practice" && familySpec(x) === "2.1",
    ))
      expect(POOL[f.slug]).toEqual({ spec: "2.1", human: [], ai: [] });
    expect(POOL["otp-login"]?.human).toHaveLength(POOL_SIZE);
  });

  test.each([
    "url-shortener",
    "photo-sharing",
    "news-feed",
    "search-autocomplete",
  ])(
    "a match played on %s before it moved to practice still rebuilds",
    (slug) => {
      const seed = POOL[slug]?.human[0];
      expect(seed).toBeDefined();
      expect(matchProblem(slug, "human", seed ?? 0, "1.0")?.slug).toBe(
        `${slug}-human-${String(seed)}`,
      );
    },
  );

  test("practice never shows a battle family, and matches never draw a practice one", () => {
    const battle = new Set(
      FAMILIES.filter((f) => f.pool === "battle").map((f) => f.slug),
    );
    expect(practiceProblems(FROM_21).some((p) => battle.has(p.slug))).toBe(
      false,
    );
    for (const battleMode of ["human", "ai"] as const)
      for (let i = 0; i < 50; i++) {
        const { family } = drawVariant(
          battleMode,
          () => i / 50,
          new Set(),
          FROM_21,
        );
        expect(battle.has(family)).toBe(true);
      }
  });
});

// HLDQ-3's three ways a variant can be invalid, each caught.
describe("validate", () => {
  const family = FAMILIES[0];
  if (family === undefined) throw new Error("no families");
  const v = variant(family, "human", 3);
  const flawed = v.flawed[0];
  if (flawed === undefined) throw new Error("no flaws");
  const client = {
    ...v.reference,
    nodes: v.reference.nodes.slice(0, 1),
    edges: [],
  };

  test("a reference that misses a scenario", () => {
    expect(validate({ ...v, reference: client })).toContain(
      'the reference design misses "baseline"',
    );
  });

  test("a flaw that fails nothing, and one that fails more than its target", () => {
    expect(
      validate({ ...v, flawed: [{ ...flawed, design: v.reference }] }),
    ).toEqual([
      `${flawed.id} should fail only "${flawed.targets}" but fails nothing`,
    ]);
    expect(validate({ ...v, flawed: [{ ...flawed, design: client }] })).toEqual(
      [
        `${flawed.id} should fail only "${flawed.targets}" but fails "baseline", "peak", "zone"`,
      ],
    );
  });
});

// ADR-0051: a flaw that leaves out what does the work fails the baseline, §6.4's gate,
// and with it every scenario; it's valid when the baseline fails.
test("a flaw aimed at the baseline must fail the baseline", () => {
  const family = FAMILIES.find((f) => f.slug === "otp-login");
  if (family === undefined) throw new Error("no otp-login");
  const v = variant(family, "human", POOL["otp-login"]?.human[0] ?? 1);
  const flaw = v.flawed.find((f) => f.id === "no-provider");
  if (flaw === undefined) throw new Error("no flaw");
  expect(validate({ ...v, flawed: [flaw] })).toEqual([]);
  expect(
    validate({ ...v, flawed: [{ ...flaw, design: v.reference }] }),
  ).toEqual(['no-provider should fail "baseline" but fails nothing']);
});

// P6-W44 (HLDQ-3, Q-P6-08): the cup problems are valid at their seeds, playable by
// matchProblem, and never in the match pool or practice.
describe.each(CUPS)("$family.slug", ({ family, seeds }) => {
  test("valid at each of its seeds, and only a tournament can play it", () => {
    for (const battleMode of ["human", "ai"] as const) {
      const seed = seeds[battleMode];
      if (seed === undefined) continue;
      expect(validate(variant(family, battleMode, seed))).toEqual([]);
      expect(matchProblem(family.slug, battleMode, seed, "1.0")?.slug).toBe(
        `${family.slug}-${battleMode}-${String(seed)}`,
      );
      expect(matchProblem(family.slug, battleMode, seed + 1, "1.0")).toBeNull();
    }
    expect(POOL[family.slug]).toBeUndefined();
    expect(practiceProblems(FROM).some((p) => p.slug === family.slug)).toBe(
      false,
    );
    expect(FAMILIES.some((f) => f.slug === family.slug)).toBe(false);
  });
});

// A family never changes its spec version (owner, 2026-11-24): a match records the one
// its family is on and rebuilds only under it, so moving a family would strand every
// match played on it. A family that needs a new version's numbers is a new family.
test("every family keeps the spec version it was made on", () => {
  expect(
    Object.fromEntries(FAMILIES.map((f) => [f.slug, familySpec(f)])),
  ).toEqual({
    "url-shortener": "1.0",
    "photo-sharing": "1.0",
    "news-feed": "1.0",
    chat: "1.0",
    "search-autocomplete": "1.0",
    checkout: "1.0",
    "metrics-ingestion": "1.0",
    "rate-limiter": "1.0",
    "qa-forum": "1.0",
    "hotel-booking": "1.0",
    "product-search": "1.0",
    "distributed-cache": "1.0",
    "otp-login": "2.0",
    "webhook-delivery": "2.0",
    "image-resizer": "2.0",
    "file-sync": "2.0",
    "video-on-demand": "2.0",
    "payment-processing": "2.0",
    "web-crawler": "2.0",
    "nearby-places": "2.1",
    "food-delivery-tracking": "2.1",
    presence: "2.1",
    "collaborative-editor": "2.1",
    "notification-service": "2.1",
    "id-generator": "2.1",
    "job-scheduler": "2.1",
    "feature-flags": "2.1",
    "like-counters": "2.1",
    "wallet-ledger": "2.1",
    "ad-click-aggregation": "2.1",
    "feature-store": "2.1",
  });
});

// ADR-0050 §6, ADR-0055: spec 2.0 and its families arrive on the day it takes effect.
// Families on 1.0 stay there: their seeds, results and matches never move.
describe("spec versions and the day they take effect", () => {
  const V2 = FAMILIES.filter((f) => familySpec(f) === "2.0");

  test("stage 1 is seven families on 2.0; the rest stay on 1.0, as their pool says", () => {
    expect(V2.map((f) => f.slug)).toEqual([
      "otp-login",
      "webhook-delivery",
      "image-resizer",
      "file-sync",
      "video-on-demand",
      "payment-processing",
      "web-crawler",
    ]);
    for (const f of FAMILIES) expect(POOL[f.slug]?.spec).toBe(familySpec(f));
    for (const { family } of CUPS) expect(familySpec(family)).toBe("1.0");
  });

  test.each(["human", "ai"] as const)(
    "before its day no %s match is drawn on a 2.0 family; from it, they are",
    (battleMode) => {
      const v2 = new Set(V2.map((f) => f.slug));
      const drawn = (now: Date) =>
        new Set(
          Array.from(
            { length: 200 },
            (_, i) =>
              drawVariant(battleMode, () => i / 200, new Set(), now).family,
          ),
        );
      expect([...drawn(BEFORE)].some((f) => v2.has(f))).toBe(false);
      expect([...drawn(FROM)].filter((f) => v2.has(f)).sort()).toEqual([
        "file-sync",
        "payment-processing",
        "video-on-demand",
        "web-crawler",
      ]);
    },
  );

  test("practice offers a 2.0 family only from its day", () => {
    const slugs = (now: Date) => practiceProblems(now).map((p) => p.slug);
    for (const slug of ["otp-login", "webhook-delivery", "image-resizer"]) {
      expect(slugs(BEFORE)).not.toContain(slug);
      expect(slugs(FROM)).toContain(slug);
    }
    expect(slugs(BEFORE)).toContain("url-shortener");
    for (const p of practiceProblems(FROM)) {
      const family = FAMILIES.find((f) => f.slug === p.slug);
      expect(family === undefined ? null : familySpec(family)).toBe(p.spec);
    }
  });

  test("a match records its family's spec and rebuilds under it, and no other", () => {
    expect(variantSpec("chat")).toBe("1.0");
    expect(variantSpec("file-sync")).toBe("2.0");
    expect(variantSpec("cup-live-scores")).toBe("1.0");
    expect(variantSpec("nope")).toBeNull();
    const seed = POOL["file-sync"]?.human[0] ?? 0;
    expect(matchProblem("file-sync", "human", seed, "2.0")?.spec).toBe("2.0");
    expect(matchProblem("file-sync", "human", seed, "1.0")).toBeNull();
    expect(
      matchProblem("chat", "human", POOL["chat"]?.human[0] ?? 0, "2.0"),
    ).toBeNull();
  });

  // HLDQ-3 for stage 1: each lesson fails its target for the reason it teaches.
  const why: Record<string, [string, RegExp]> = {
    "otp-login/provider-inline": [
      "provider_down",
      /^"request_code": .* 0\.0% served\.$/,
    ],
    "webhook-delivery/short-retention": [
      "endpoints_down",
      /the backlog outlives the retention/,
    ],
    "image-resizer/no-cdn": ["peak", /^resizers is overloaded/],
    // The two lessons v2.0 had left to the rubric (owner, 2026-11-24), restored.
    "image-resizer/renderers-for-the-average": [
      "upload_burst",
      /"original" isn't done in time: the backlog drains too slowly/,
    ],
    "web-crawler/short-frontier": [
      "sitemap",
      /"fetch" isn't done in time: the backlog outlives the retention/,
    ],
    "file-sync/uploads-through-app": ["peak", /^api is overloaded/],
    "video-on-demand/transcoders-for-the-average": [
      "backlog",
      /"upload" isn't done in time: the backlog drains too slowly/,
    ],
    "payment-processing/capture-inline": [
      "network_down",
      /^"capture": .* 0\.0% served\.$/,
    ],
    // ADR-0051's `requires`: the work never done fails the baseline, the gate.
    "otp-login/no-provider": [
      "baseline",
      /^"request_code" requests never reach an external provider/,
    ],
    "webhook-delivery/no-provider": [
      "baseline",
      /^"event" requests never reach an external provider/,
    ],
    "payment-processing/no-provider": [
      "baseline",
      /^"capture" requests never reach an external provider/,
    ],
    "web-crawler/no-provider": [
      "baseline",
      /^"fetch" requests never reach an external provider/,
    ],
    "video-on-demand/no-transcoding": [
      "baseline",
      /^"upload" requests never reach a worker/,
    ],
    "image-resizer/no-renditions": [
      "baseline",
      /^"original" requests never reach a worker/,
    ],
  };
  test.each(Object.entries(why))(
    "%s fails %s for its reason",
    (id, [target, reason]) => {
      const [slug, lesson] = id.split("/");
      const family = V2.find((f) => f.slug === slug);
      if (family === undefined) throw new Error(`no ${id}`);
      for (const battleMode of ["human", "ai"] as const) {
        const v = variant(
          family,
          battleMode,
          POOL[family.slug]?.[battleMode][0] ?? 0,
        );
        const flaw = v.flawed.find((f) => f.id === lesson);
        if (flaw === undefined) throw new Error(`no flaw ${id}`);
        const s = simulate(v.problem, flaw.design).scenarios.find(
          (x) => x.id === target,
        );
        expect(s?.targetsMet).toBe(false);
        expect(s?.explanations).toContainEqual(expect.stringMatching(reason));
      }
    },
  );

  // ADR-0051: dropping the provider, or the queue that hands work to the workers, never
  // pays: the work they do is what the request type requires.
  test.each(V2.map((f) => [f.slug, f] as const))(
    "%s: its reference without a provider or a queue loses points",
    (_, family) => {
      for (const battleMode of ["human", "ai"] as const) {
        const v = variant(
          family,
          battleMode,
          POOL[family.slug]?.[battleMode][0] ?? 1,
        );
        const full = simulate(v.problem, v.reference).points;
        for (const n of v.reference.nodes)
          if (n.kind === "external_api" || n.kind === "queue")
            expect(
              simulate(v.problem, removeNode(v.reference, n.id)).points,
              `${family.slug} ${battleMode} without ${n.id}`,
            ).toBeLessThan(full);
      }
    },
  );

  // ADR-0053: the player picks the provider and channel where the family offers it,
  // priced for its users' region; the rest keep the price their family sets.
  describe("selectable providers", () => {
    const of = (slug: string) => {
      const family = FAMILIES.find((f) => f.slug === slug);
      if (family === undefined) throw new Error(`no ${slug}`);
      return family;
    };
    const first = (slug: string, battleMode: "human" | "ai") =>
      variant(of(slug), battleMode, POOL[slug]?.[battleMode][0] ?? 1);
    const pickOf = (v: ReturnType<typeof variant>) =>
      v.reference.nodes.find((n) => n.kind === "external_api")?.config;

    test("codes go to phones or inboxes in India; payments are cards in the US; notifications are pushed", () => {
      const otp = first("otp-login", "human");
      expect(otp.problem.traffic.provider).toEqual({
        region: "in",
        channels: ["sms", "whatsapp", "voice", "email"],
      });
      expect(otp.problem.traffic.providerCostPerCall).toBeUndefined();
      expect(pickOf(otp)).toEqual({ provider: "msg91", channel: "sms" });
      const pay = first("payment-processing", "human");
      // The fee target is the cheapest processor's in the region: Stripe's $1.46.
      expect(pay.problem.traffic.provider).toEqual({
        region: "us",
        channels: ["card"],
        ticketUsd: 40,
        feeTargetUsd: 1.46,
      });
      expect(pickOf(pay)).toEqual({ provider: "stripe", channel: "card" });
      // The fee is charged at capture; the authorization is free.
      expect(
        pay.problem.traffic.requests.find((r) => r.type === "authorize")
          ?.billed,
      ).toBe(false);
      expect(otp.problem.requirements.at(-3)).toMatch(
        /Its users are in India: pick its provider and channel\.$/,
      );
      expect(pay.problem.requirements.at(-4)).toMatch(
        /Its users are in the US, paying \$40 on average: pick its provider\.$/,
      );
      expect(pay.problem.requirements.at(-1)).toBe(
        "Processing fees of at most $1.46 a payment, paid apart from the budget.",
      );
      expect(pay.problem.covers?.at(-1)).toEqual({ rule: "fees" });
      const push = first("notification-service", "human");
      expect(push.problem.traffic.provider).toEqual({
        region: "us",
        channels: ["push"],
        monthlyUsers: 10_000_000,
      });
      expect(pickOf(push)).toEqual({ provider: "fcm", channel: "push" });
      // Not messaging, payments or push: customers' endpoints, the open web.
      for (const slug of ["webhook-delivery", "web-crawler"]) {
        const v = first(slug, "human");
        expect(v.problem.traffic.provider).toBeUndefined();
        expect(v.problem.traffic.providerCostPerCall).toBeDefined();
      }
    });

    test.each(["human", "ai"] as const)(
      "%s: messaging fees are budgeted at the reference's pick, payment fees not at all",
      (battleMode) => {
        const headroom = battleMode === "ai" ? 1.2 : 1.5;
        for (const slug of ["otp-login", "notification-service"]) {
          const v = first(slug, battleMode);
          const r = simulate(v.problem, v.reference);
          const fees = r.providerCostPerMonth ?? 0;
          expect(v.problem.budgetPerMonth).toBe(
            Math.ceil(((r.costPerMonth - fees) * headroom + fees) / 100) * 100,
          );
        }
        const otp = simulate(
          first("otp-login", battleMode).problem,
          first("otp-login", battleMode).reference,
        );
        expect(otp.providerCostPerMonth ?? 0).toBeGreaterThan(
          otp.costPerMonth / 2,
        );
        // Payment processing's budget is its infrastructure's alone.
        const pay = first("payment-processing", battleMode);
        const r = simulate(pay.problem, pay.reference);
        expect(r.providerCostPerMonth).toBe(0);
        expect(r.fees?.perPayment).toBeCloseTo(1.46, 10);
        expect(pay.problem.budgetPerMonth).toBe(
          Math.ceil((r.costPerMonth * headroom) / 100) * 100,
        );
        expect(pay.problem.budgetPerMonth).toBeLessThan(10_000);
      },
    );

    // The lessons a wrong pick teaches: its fees blow the budget, or the fee target,
    // and nothing else.
    test.each([
      ["otp-login", "twilio-sms", "budget"],
      ["notification-service", "onesignal-per-user", "budget"],
      ["payment-processing", "paypal-fees", "fees"],
    ] as const)("%s/%s fails on its fees alone", (slug, lesson, target) => {
      for (const battleMode of ["human", "ai"] as const) {
        const v = first(slug, battleMode);
        const flaw = v.flawed.find((f) => f.id === lesson);
        expect(flaw?.targets).toBe(target);
        expect(
          validate({ ...v, flawed: flaw === undefined ? [] : [flaw] }),
        ).toEqual([]);
        const flawed = simulate(v.problem, flaw?.design ?? v.reference);
        if (target === "budget")
          expect(flawed.costPerMonth).toBeGreaterThan(v.problem.budgetPerMonth);
        else {
          expect(flawed.costPerMonth).toBeLessThanOrEqual(
            v.problem.budgetPerMonth,
          );
          expect(flawed.fees?.perPayment ?? 0).toBeGreaterThan(
            flawed.fees?.target ?? Infinity,
          );
        }
      }
    });
    test("Twilio's SMS in India costs about 46 times MSG91's", () => {
      const v = first("otp-login", "human");
      const flaw = v.flawed.find((f) => f.id === "twilio-sms");
      const ratio =
        (simulate(v.problem, flaw?.design ?? v.reference)
          .providerCostPerMonth ?? 0) /
        (simulate(v.problem, v.reference).providerCostPerMonth ?? 1);
      expect(Math.round(ratio)).toBe(46);
    });
  });

  test("video without a CDN fails on its cost alone: origin bytes cost four times a CDN's", () => {
    const family = V2.find((f) => f.slug === "video-on-demand");
    if (family === undefined) throw new Error("no video-on-demand");
    const v = variant(family, "human", POOL["video-on-demand"]?.human[0] ?? 0);
    const flaw = v.flawed.find((f) => f.id === "no-cdn");
    if (flaw === undefined) throw new Error("no flaw");
    const r = simulate(v.problem, flaw.design);
    expect(r.costPerMonth).toBeGreaterThan(v.problem.budgetPerMonth);
    expect(simulate(v.problem, v.reference).costPerMonth).toBeLessThan(
      v.problem.budgetPerMonth,
    );
  });
});

// ADR-0050 stage 2, ADR-0055: spec 2.1 and its families arrive on the day it takes
// effect, the same as 2.0's. Families on 1.0 and 2.0 stay there.
describe("spec 2.1 and the day it takes effect", () => {
  const V21 = FAMILIES.filter((f) => familySpec(f) === "2.1");

  test("stage 2 is twelve families on 2.1, five of them practice", () => {
    expect(V21.map((f) => [f.slug, f.pool])).toEqual([
      ["nearby-places", "practice"],
      ["food-delivery-tracking", "battle"],
      ["presence", "practice"],
      ["collaborative-editor", "battle"],
      ["notification-service", "battle"],
      ["id-generator", "practice"],
      ["job-scheduler", "battle"],
      ["feature-flags", "battle"],
      ["like-counters", "battle"],
      ["wallet-ledger", "practice"],
      ["ad-click-aggregation", "battle"],
      ["feature-store", "practice"],
    ]);
  });

  test.each(["human", "ai"] as const)(
    "before its day no %s match is drawn on a 2.1 family; from it, the seven battle ones are",
    (battleMode) => {
      const v21 = new Set(V21.map((f) => f.slug));
      const drawn = (now: Date) =>
        new Set(
          Array.from(
            { length: 400 },
            (_, i) =>
              drawVariant(battleMode, () => i / 400, new Set(), now).family,
          ),
        );
      expect([...drawn(BEFORE_21)].some((f) => v21.has(f))).toBe(false);
      expect([...drawn(FROM_21)].filter((f) => v21.has(f)).sort()).toEqual([
        "ad-click-aggregation",
        "collaborative-editor",
        "feature-flags",
        "food-delivery-tracking",
        "job-scheduler",
        "like-counters",
        "notification-service",
      ]);
    },
  );

  test("practice offers a 2.1 family only from its day", () => {
    const slugs = (now: Date) => practiceProblems(now).map((p) => p.slug);
    for (const slug of [
      "nearby-places",
      "presence",
      "id-generator",
      "wallet-ledger",
      "feature-store",
    ]) {
      expect(slugs(BEFORE_21)).not.toContain(slug);
      expect(slugs(FROM_21)).toContain(slug);
    }
  });

  // ADR-0055 (owner, 2026-11-26): 2.0 and 2.1 take effect together, today, for
  // practice and both battle modes, each family in its own pool. Tournament rounds are
  // the admin's pick, gated in apps/web (hld-tournaments.test.ts, actions.test.ts).
  test("on 26 November 2026 every 2.0 and 2.1 family is offered in its pool", () => {
    const today = new Date("2026-11-26T09:00:00Z");
    const practice = new Set(practiceProblems(today).map((p) => p.slug));
    const drawn = new Set(
      (["human", "ai"] as const).flatMap((battleMode) =>
        Array.from(
          { length: 400 },
          (_, i) =>
            drawVariant(battleMode, () => i / 400, new Set(), today).family,
        ),
      ),
    );
    for (const family of FAMILIES.filter((f) => familySpec(f) !== "1.0")) {
      const offered =
        family.pool === "practice"
          ? practice.has(family.slug)
          : drawn.has(family.slug);
      expect(offered, family.slug).toBe(true);
      expect(specInEffect(familySpec(family), today)).toBe(true);
    }
    expect(practice).toEqual(
      new Set(practiceFamilies(FAMILIES).map((f) => f.slug)),
    );
    expect(
      [...drawn].some((slug) => variantSpec(slug) === "2.0") &&
        [...drawn].some((slug) => variantSpec(slug) === "2.1"),
    ).toBe(true);
  });

  test("a match records 2.1 and rebuilds under it, and no other", () => {
    expect(variantSpec("like-counters")).toBe("2.1");
    const seed = POOL["like-counters"]?.human[0] ?? 0;
    expect(matchProblem("like-counters", "human", seed, "2.1")?.spec).toBe(
      "2.1",
    );
    expect(matchProblem("like-counters", "human", seed, "2.0")).toBeNull();
  });

  // HLDQ-3 for stage 2: each lesson fails its target for the reason it teaches. A
  // practice family is checked at its practice seed, a battle family at its first pooled
  // seed in each mode.
  const why: Record<string, [string, RegExp]> = {
    "nearby-places/shards-not-replicas": [
      "peak",
      /^places's busiest partition is overloaded/,
    ],
    "food-delivery-tracking/positions-in-the-database": [
      "baseline",
      /^orders is overloaded/,
    ],
    "food-delivery-tracking/no-gateway": [
      "baseline",
      /^"track" requests never reach/,
    ],
    "presence/connect-sized-for-a-spike": ["zone", /^auth is overloaded/],
    "presence/no-gateway": [
      "baseline",
      /^"status_change" requests never reach a connection gateway/,
    ],
    "collaborative-editor/broadcast-in-the-request": [
      "baseline",
      /^"edit": p99 [\d,.]+ ms \(target/,
    ],
    "collaborative-editor/no-gateway": [
      "baseline",
      /^"edit" requests never reach a connection gateway/,
    ],
    "notification-service/notify-inline": [
      "provider_down",
      /^"notify": .* 0\.0% served\.$/,
    ],
    "notification-service/campaign-inline": [
      "baseline",
      /^"campaign": p99 [\d,.]+ ms \(target/,
    ],
    "id-generator/no-blocks": ["baseline", /^leases is overloaded/],
    "id-generator/quorum-in-two-zones": [
      "zone",
      /^leases has lost its quorum: 1 of 3 members left/,
    ],
    "job-scheduler/runners-for-the-average": [
      "midnight",
      /"fire" isn't done in time: the backlog drains too slowly/,
    ],
    "job-scheduler/no-leader": ["baseline", /^"lease" requests never reach/],
    "feature-flags/no-cdn": ["peak", /^api is overloaded/],
    "feature-flags/no-gateway": [
      "baseline",
      /^"change" requests never reach a connection gateway/,
    ],
    "like-counters/views-straight-to-counters": [
      "peak",
      /^counts's busiest partition is overloaded/,
    ],
    "wallet-ledger/credits-one-by-one": ["peak", /^ledger is overloaded/],
    "ad-click-aggregation/per-click-increments": [
      "peak",
      /^counts's busiest partition is overloaded/,
    ],
    "feature-store/backfill-unbatched": ["overlap", /^online is overloaded/],
  };
  test.each(Object.entries(why))(
    "%s fails %s for its reason",
    (id, [target, reason]) => {
      const [slug, lesson] = id.split("/");
      const family = V21.find((f) => f.slug === slug);
      if (family === undefined) throw new Error(`no ${id}`);
      const modes =
        family.pool === "practice"
          ? [["human", family.practiceSeeds[0] ?? 1] as const]
          : (["human", "ai"] as const).map(
              (m) => [m, POOL[family.slug]?.[m][0] ?? 0] as const,
            );
      for (const [battleMode, seed] of modes) {
        const v = variant(family, battleMode, seed);
        const flaw = v.flawed.find((f) => f.id === lesson);
        if (flaw === undefined) throw new Error(`no flaw ${id}`);
        const at =
          battleMode === "ai" && flaw.targets !== target
            ? flaw.targets
            : target;
        const s = simulate(v.problem, flaw.design).scenarios.find(
          (x) => x.id === at,
        );
        expect(s?.targetsMet, `${id} ${battleMode}`).toBe(false);
        expect(s?.explanations).toContainEqual(expect.stringMatching(reason));
      }
    },
  );

  // A lesson may name a different target per battle mode: the AI mode's lost region is
  // its harsher reconnect storm.
  test("presence's storm lesson fails a lost zone, or in the AI mode a lost region", () => {
    const family = V21.find((f) => f.slug === "presence");
    if (family === undefined) throw new Error("no presence");
    const target = (battleMode: "human" | "ai") =>
      variant(family, battleMode, 1).flawed.find(
        (f) => f.id === "connect-sized-for-a-spike",
      )?.targets;
    expect(target("human")).toBe("zone");
    expect(target("ai")).toBe("region");
  });
});
