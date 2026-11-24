import { describe, expect, test } from "vitest";
import { coverage } from "./coverage";
import type { Design } from "./design";
import { configFields, defaultConfig, updateNode } from "./edit";
import { DIRECT, QUEUED, SIGN_IN } from "./fixtures.test-helpers";
import { hints } from "./hints";
import { judgeInput } from "./judge";
import { HldProblem } from "./problem";
import { picked, pickProvider, priceIn, providerOffer } from "./providers";
import { simulate } from "./simulate";
import { specVersion, SPEC_VERSIONS } from "./spec";

// ADR-0053: the provider and channel a player picks on the external provider, priced
// from the spec sheet for the problem's region (docs/hld-provider-prices.md).

const V2 = specVersion("2.0");
if (V2 === null) throw new Error("no spec 2.0");
const issues = (problem: unknown) =>
  HldProblem.safeParse(problem).error?.issues.map((i) => i.message) ?? [];

// SIGN_IN with its users in India, reached by phone: the player picks who sends.
const signInTraffic = Object.fromEntries(
  Object.entries(SIGN_IN.traffic).filter(([k]) => k !== "providerCostPerCall"),
) as Omit<HldProblem["traffic"], "providerCostPerCall">;
const INDIA = HldProblem.parse({
  ...SIGN_IN,
  budgetPerMonth: 1_000_000,
  traffic: {
    ...signInTraffic,
    provider: { region: "in", channels: ["sms", "whatsapp", "voice"] },
  },
});
const pick = (design: Design, provider: string, channel: string) =>
  updateNode(design, "sms", { config: { provider, channel } });

// Card payments in the US: an authorization in the request, its capture queued; the
// fee is charged once, at capture.
const PAYMENTS = HldProblem.parse({
  ...SIGN_IN,
  slug: "payments",
  budgetPerMonth: 40_000,
  traffic: {
    ...signInTraffic,
    requests: [
      { type: "session", rps: 800, kind: "read", cacheable: false },
      {
        type: "authorize",
        rps: 40,
        kind: "write",
        cacheable: false,
        requires: ["external_api"],
        billed: false,
      },
      {
        type: "send_code",
        rps: 40,
        kind: "write",
        cacheable: false,
        completionSeconds: 900,
        requires: ["external_api"],
      },
    ],
    // Owner, 2026-11-24: fees per payment have their own target, the cheapest
    // processor's ($1.46 at Stripe), outside the infrastructure budget.
    provider: {
      region: "us",
      channels: ["card"],
      ticketUsd: 40,
      feeTargetUsd: 1.46,
    },
  },
  scenarios: SIGN_IN.scenarios,
});
const CHARGED: Design = {
  ...QUEUED,
  edges: [
    ...QUEUED.edges.map((e) =>
      e.from === "users" || e.from === "lb"
        ? { ...e, routes: ["session", "authorize", "send_code"] }
        : e.from === "api" && e.to === "codes"
          ? { ...e, routes: ["session", "authorize", "send_code"] }
          : e,
    ),
    { from: "api", to: "sms", routes: ["authorize"] },
  ],
};

describe("the spec sheet's provider table", () => {
  test("2.0 brings it, 2.1 keeps it, and 1.0 never has it", () => {
    expect(specVersion("1.0")?.features.providers).toBeUndefined();
    expect(V2.features.providers?.seen).toBe("2026-11-24");
    expect(specVersion("2.1")?.features.providers).toEqual(
      V2.features.providers,
    );
  });

  test("every entry cites its source, and is priced in USD or can't be picked", () => {
    const prices = V2.features.providers?.prices ?? [];
    expect(prices.length).toBeGreaterThan(30);
    for (const p of prices) {
      expect(p.source).toMatch(/^https:\/\//);
      if (p.perUnit !== null) expect(p.perUnit).toBeGreaterThanOrEqual(0);
      if (p.perUnit !== null)
        expect(p.percent !== undefined).toBe(p.channel === "card");
      if (p.availability !== null) expect(p.availability).toBeLessThan(1);
    }
    // One entry per provider, channel and region.
    const keys = prices.map((p) => `${p.provider}/${p.channel}/${p.region}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("the doc's prices: an SMS in India costs about 46 times more at Twilio than at MSG91", () => {
    const twilio = priceIn(V2, "in", "twilio", "sms")?.perUnit ?? 0;
    const msg91 = priceIn(V2, "in", "msg91", "sms")?.perUnit ?? 1;
    expect(twilio).toBe(0.0832);
    expect(msg91).toBe(0.0018);
    expect(Math.round(twilio / msg91)).toBe(46);
    expect(priceIn(V2, "us", "stripe", "card")).toMatchObject({
      perUnit: 0.3,
      percent: 0.029,
    });
    expect(priceIn(V2, "us", "razorpay", "card")?.perUnit).toBeNull();
    expect(priceIn(V2, "in", "vonage", "whatsapp")?.perUnit).toBeNull();
    // Published SLAs only; MSG91 publishes none.
    expect(priceIn(V2, "in", "twilio", "sms")?.availability).toBe(0.9995);
    expect(priceIn(V2, "in", "msg91", "sms")?.availability).toBeNull();
  });
});

describe("a problem that offers a pick", () => {
  test("is valid, and only under a version with the table", () => {
    expect(issues(INDIA)).toEqual([]);
    expect(issues(PAYMENTS)).toEqual([]);
    expect(SPEC_VERSIONS.map((s) => s.version)).toContain("1.0");
    expect(issues({ ...INDIA, spec: "1.0" })).toEqual(
      expect.arrayContaining(["spec 1.0 has no provider to pick"]),
    );
  });

  test("names a price or an offer, never both, and a card payment's ticket", () => {
    expect(
      issues({
        ...INDIA,
        traffic: { ...INDIA.traffic, providerCostPerCall: 1 },
      }),
    ).toEqual(["a price per call and a provider to pick"]);
    expect(issues({ ...SIGN_IN, traffic: signInTraffic })).toEqual([
      "an external provider without its rate limit and price",
    ]);
    const offer = (provider: object) =>
      issues({ ...INDIA, traffic: { ...INDIA.traffic, provider } });
    expect(offer({ region: "us", channels: ["card"] })).toEqual([
      "card payments without an average ticket and a fee target",
    ]);
    expect(offer({ region: "us", channels: ["sms"], ticketUsd: 40 })).toEqual([
      "an average ticket or a fee target without card payments",
    ]);
    expect(offer({ region: "us", channels: ["push"] })).toEqual([
      "push without its monthly active users",
    ]);
    expect(
      offer({ region: "us", channels: ["sms"], monthlyUsers: 1_000 }),
    ).toEqual(["monthly active users without push"]);
    expect(
      offer({
        region: "us",
        channels: ["sms", "card"],
        ticketUsd: 40,
        feeTargetUsd: 1,
      }),
    ).toEqual(["card payments offered with messaging channels"]);
  });
});

describe("simulating a pick", () => {
  test("MSG91's SMS in India: billed per message, its price named", () => {
    const r = simulate(INDIA, pick(QUEUED, "msg91", "sms"));
    expect(r.scenarios.every((s) => s.targetsMet)).toBe(true);
    // 80 codes a second for a month, at $0.0018 each.
    expect(r.providerCostPerMonth).toBeCloseTo(80 * 730 * 3600 * 0.0018, 2);
    expect(r.explanations).toContain(
      "Of which $378,432 is the provider's calls and $0 is bytes served.",
    );
    expect(r.explanations).toContain("sms: MSG91 SMS, $0.0018 per SMS.");
    const sms = r.scenarios[0]?.nodes.find((n) => n.id === "sms");
    expect(sms?.provider).toBe("MSG91 SMS");
  });

  test("the same codes through Twilio cost 46 times as much", () => {
    const msg91 = simulate(INDIA, pick(QUEUED, "msg91", "sms"));
    const twilio = simulate(INDIA, pick(QUEUED, "twilio", "sms"));
    expect(
      Math.round(
        (twilio.providerCostPerMonth ?? 0) / (msg91.providerCostPerMonth ?? 1),
      ),
    ).toBe(46);
    expect(twilio.costPerMonth - msg91.costPerMonth).toBeCloseTo(
      80 * 730 * 3600 * (0.0832 - 0.0018),
      0,
    );
  });

  test("a monthly subscription is billed once, on top", () => {
    const r = simulate(INDIA, pick(QUEUED, "msg91", "whatsapp"));
    expect(r.providerCostPerMonth).toBeCloseTo(
      80 * 730 * 3600 * 0.0012 + 5.38,
      2,
    );
  });

  test("a published SLA is the provider's availability; an unpublished one is the sheet's estimate", () => {
    const at = (provider: string) =>
      simulate(INDIA, pick(DIRECT, provider, "sms")).scenarios[0]?.types.find(
        (t) => t.type === "send_code",
      )?.availability ?? 0;
    expect(at("twilio")).toBeGreaterThan(at("msg91"));
    expect(at("msg91")).toBeCloseTo(
      simulate(SIGN_IN, DIRECT).scenarios[0]?.types.find(
        (t) => t.type === "send_code",
      )?.availability ?? 0,
      10,
    );
  });

  test("nothing picked, a channel the problem doesn't use, or one not offered there: no work done", () => {
    const cases: [Design, string][] = [
      [QUEUED, "sms has no provider and channel picked, so it does no work."],
      [
        pick(QUEUED, "amazon", "email"),
        "sms: this problem doesn't reach its users by Email, so it does no work.",
      ],
      [
        pick(QUEUED, "vonage", "whatsapp"),
        "sms: Vonage doesn't offer WhatsApp at a published price in India, so it does no work.",
      ],
    ];
    for (const [design, why] of cases) {
      const r = simulate(INDIA, design);
      expect(r.explanations).toContain(why);
      const baseline = r.scenarios.find((s) => s.id === "baseline");
      expect(baseline?.targetsMet).toBe(false);
      expect(
        baseline?.types.find((t) => t.type === "send_code")?.availability,
      ).toBe(0);
      expect(baseline?.explanations).toContainEqual(
        '"send_code" requests reach sms, but it has no provider it can use, so none is served.',
      );
      expect(baseline?.nodes.find((n) => n.id === "sms")?.provider).toBeNull();
      expect(r.providerCostPerMonth).toBe(0);
    }
  });

  test("a payment's fee is its share of the ticket plus the fixed fee, charged once, at capture", () => {
    const stripe = simulate(PAYMENTS, pick(CHARGED, "stripe", "card"));
    // Authorizations in the request fail with the provider's outage, by design here.
    expect(stripe.baselinePassed).toBe(true);
    expect(stripe.explanations).toContain(
      "sms: Stripe, 2.9% + $0.30 per payment ($1.46 at $40).",
    );
    // 40 captures a second for a month, at 2.9% of $40 + $0.30; authorizations free.
    expect(stripe.fees?.perMonth).toBeCloseTo(
      40 * 730 * 3600 * (0.029 * 40 + 0.3),
      0,
    );
    expect(stripe.fees?.perPayment).toBeCloseTo(1.46, 10);
    const paypal = simulate(PAYMENTS, pick(CHARGED, "paypal", "card"));
    expect(paypal.fees?.perMonth).toBeCloseTo(
      40 * 730 * 3600 * (0.0299 * 40 + 0.49),
      0,
    );
    // Razorpay lists no US price: it can't be picked there.
    const razorpay = simulate(PAYMENTS, pick(CHARGED, "razorpay", "card"));
    expect(razorpay.baselinePassed).toBe(false);
    expect(razorpay.fees?.perPayment).toBeNull();
  });

  // Owner, 2026-11-24: processing fees are no part of the infrastructure budget; they
  // have their own target, fees per payment.
  test("payment fees stay out of the budget and answer to their own target", () => {
    const stripe = simulate(PAYMENTS, pick(CHARGED, "stripe", "card"));
    expect(stripe.costPerMonth).toBeLessThan(PAYMENTS.budgetPerMonth);
    expect(stripe.providerCostPerMonth).toBe(0);
    expect(stripe.fees?.target).toBe(1.46);
    expect(stripe.explanations).toContain(
      "Fees per payment: $1.46 at Stripe, against a target of $1.46. $153,475,200 a month, paid apart from the infrastructure budget.",
    );
    const paypal = simulate(PAYMENTS, pick(CHARGED, "paypal", "card"));
    expect(paypal.costPerMonth).toBe(stripe.costPerMonth);
    const baseline = paypal.scenarios.find((s) => s.id === "baseline");
    expect(baseline?.targetsMet).toBe(false);
    expect(paypal.explanations).toContain(
      "Fees per payment: $1.69 at PayPal, over the target of $1.46. $177,232,320 a month, paid apart from the infrastructure budget.",
    );
    // Lifted, the fee target leaves PayPal meeting every target Stripe meets.
    const lifted = {
      ...PAYMENTS,
      traffic: {
        ...PAYMENTS.traffic,
        provider: { ...PAYMENTS.traffic.provider, feeTargetUsd: Infinity },
      },
    } as HldProblem;
    expect(
      simulate(lifted, pick(CHARGED, "paypal", "card")).baselinePassed,
    ).toBe(true);
  });

  test("push: free at FCM and APNs, per delivery at Amazon, per monthly user at OneSignal", () => {
    const PUSH = HldProblem.parse({
      ...INDIA,
      traffic: {
        ...INDIA.traffic,
        provider: { region: "us", channels: ["push"], monthlyUsers: 1_000_000 },
      },
    });
    const month = 80 * 730 * 3600;
    const cost = (provider: string) =>
      simulate(PUSH, pick(QUEUED, provider, "push")).providerCostPerMonth;
    expect(cost("fcm")).toBe(0);
    expect(cost("apns")).toBe(0);
    expect(cost("amazon")).toBeCloseTo(month * 0.000001, 2);
    expect(cost("onesignal")).toBeCloseTo(19 + 0.012 * 1_000_000, 2);
    expect(priceIn(V2, "us", "onesignal", "push")).toMatchObject({
      perUnit: 0,
      monthly: 19,
      perUser: 0.012,
    });
  });

  test("a problem that sets its own price ignores a pick, and says nothing of it", () => {
    const plain = simulate(SIGN_IN, QUEUED);
    const withPick = simulate(SIGN_IN, pick(QUEUED, "twilio", "sms"));
    expect(withPick).toEqual(plain);
    expect(plain.providerCostPerMonth).toBeUndefined();
    expect(
      plain.scenarios[0]?.nodes.find((n) => n.id === "sms"),
    ).not.toHaveProperty("provider");
  });
});

describe("the canvas's offer", () => {
  test("a problem without a pick offers none, and the provider has no fields of its own", () => {
    expect(providerOffer(SIGN_IN)).toBeNull();
    expect(configFields("external_api", V2)).toEqual([]);
    expect(defaultConfig("external_api", V2)).toEqual({});
  });

  test("India by phone: each provider's cheapest, and a provider's channels with their prices", () => {
    const offer = providerOffer(INDIA, "msg91");
    expect(offer?.region).toBe("India");
    expect(offer?.providers).toEqual([
      { id: "twilio", name: "Twilio", from: "from $0.0062 per message" },
      {
        id: "msg91",
        name: "MSG91",
        from: "from $0.0012 per message + $5.38 a month",
      },
      { id: "amazon", name: "Amazon", from: "from $0.0032 per message" },
      { id: "vonage", name: "Vonage", from: "from $0.0748 per call" },
    ]);
    expect(offer?.channels).toEqual([
      { id: "sms", name: "SMS", price: "$0.0018 per SMS" },
      {
        id: "whatsapp",
        name: "WhatsApp",
        price: "$0.0012 per message + $5.38 a month",
      },
      { id: "voice", name: "Voice call", price: "$0.0054 per call" },
    ]);
    expect(
      providerOffer(INDIA, "vonage")?.channels.find((c) => c.id === "whatsapp")
        ?.price,
    ).toBeNull();
  });

  test("card payments in the US: the fee at the problem's ticket, and Razorpay not offered", () => {
    const offer = providerOffer(PAYMENTS, "stripe");
    expect(offer?.providers).toEqual([
      {
        id: "stripe",
        name: "Stripe",
        from: "2.9% + $0.30 per payment ($1.46 at $40)",
      },
      { id: "razorpay", name: "Razorpay", from: null },
      {
        id: "paypal",
        name: "PayPal",
        from: "2.99% + $0.49 per payment ($1.69 at $40)",
      },
    ]);
  });

  test("picking a provider keeps the channel only where it's offered", () => {
    const config = (d: Design) =>
      d.nodes.find((n) => n.id === "sms")?.config ?? null;
    let d = pickProvider(QUEUED, INDIA, "sms", { provider: "msg91" });
    expect(config(d)).toEqual({ provider: "msg91" });
    d = pickProvider(d, INDIA, "sms", { channel: "whatsapp" });
    expect(config(d)).toEqual({ provider: "msg91", channel: "whatsapp" });
    // Vonage's WhatsApp isn't published: the channel is dropped, to be picked again.
    d = pickProvider(d, INDIA, "sms", { provider: "vonage" });
    expect(config(d)).toEqual({ provider: "vonage" });
    d = pickProvider(d, INDIA, "sms", { provider: "twilio", channel: "sms" });
    expect(config(d)).toEqual({ provider: "twilio", channel: "sms" });
    // Only an external provider is picked for.
    expect(pickProvider(QUEUED, INDIA, "api", { provider: "msg91" })).toBe(
      QUEUED,
    );
  });

  test("picked() names the pick, or why it can't be used", () => {
    const node = (config: object) => ({
      id: "sms",
      kind: "external_api" as const,
      config,
      note: "",
    });
    expect(
      picked(INDIA, V2, node({ provider: "msg91", channel: "sms" })),
    ).toEqual({
      ok: true,
      name: "MSG91 SMS",
      perCall: 0.0018,
      monthly: 0,
      card: false,
      label: "$0.0018 per SMS",
      availability: null,
    });
    expect(picked(SIGN_IN, V2, node({}))).toBeNull();
  });
});

describe("words for the player", () => {
  test("hints name the provider, and ask for a pick", () => {
    expect(hints(INDIA, simulate(INDIA, QUEUED))[0]).toBe(
      "Pick the external provider's provider and channel, from those offered in India: until then it does no work.",
    );
    const twilio = pick(QUEUED, "twilio", "sms");
    expect(hints(INDIA, simulate(INDIA, twilio))).toContain(
      "The design costs more than the budget, and most of it is the Twilio SMS fees: send it only what it delivers, and compare what each provider and channel costs in India.",
    );
    const limited = {
      ...INDIA,
      traffic: { ...INDIA.traffic, providerRps: 50 },
    };
    expect(hints(limited, simulate(limited, twilio))).toContainEqual(
      expect.stringMatching(
        /^The external provider \(Twilio SMS\) hits its rate limit/,
      ),
    );
  });

  test("fees over their target are a hint of their own", () => {
    const paypal = pick(CHARGED, "paypal", "card");
    expect(hints(PAYMENTS, simulate(PAYMENTS, paypal))).toContain(
      "Fees per payment at PayPal are over their target: compare what each payment provider charges in the US at this ticket.",
    );
  });

  test("coverage says which provider sends", () => {
    const design = pick(QUEUED, "msg91", "sms");
    const c = coverage(
      {
        ...INDIA,
        covers: [
          { rule: "request", request: "send_code", through: ["external_api"] },
          { rule: "budget" },
          { rule: "storage" },
        ],
      },
      design,
      simulate(INDIA, design),
    );
    expect(c.items[0]?.by).toBe("External provider, MSG91 SMS");
  });

  test("the judge reads fees per payment and their target", () => {
    const design = pick(CHARGED, "paypal", "card");
    const input = judgeInput(PAYMENTS, design, simulate(PAYMENTS, design));
    expect(input.simulation.feePerPayment).toBe(1.69);
    expect(input.simulation.feeTargetPerPayment).toBe(1.46);
    const plain = judgeInput(INDIA, QUEUED, simulate(INDIA, QUEUED));
    expect(plain.simulation).not.toHaveProperty("feePerPayment");
  });

  test("the judge reads the pick as structured fields", () => {
    const design = pick(QUEUED, "msg91", "sms");
    const input = judgeInput(INDIA, design, simulate(INDIA, design));
    expect(input.components.find((c) => c.id === "sms")?.config).toEqual({
      provider: "msg91",
      channel: "sms",
    });
  });
});
