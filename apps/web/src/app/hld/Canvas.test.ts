import {
  addComponent,
  allPracticeProblems,
  connect,
  FAMILIES,
  pickProvider,
  POOL,
  practiceProblems,
  type ScenarioResult,
  setRoutes,
  simulate,
  starterDesign,
  updateNode,
  variant,
} from "@interval/hld";
import { expect, test } from "vitest";
import { risksOf, scenarioLine } from "./Canvas";
import { nodeRole } from "./flow";

const SHORTENER = (() => {
  const p = practiceProblems(new Date()).find(
    (x) => x.slug === "url-shortener",
  );
  if (p === undefined) throw new Error("no url-shortener practice problem");
  return p;
})();

const row = (over: Partial<ScenarioResult>): ScenarioResult => ({
  id: "baseline",
  name: "A normal day",
  weight: 1,
  score: 1,
  targetsMet: true,
  p99Ms: 140.4,
  availability: 0.98,
  types: [],
  nodes: [],
  explanations: [],
  ...over,
});

// A scenario reads as one plain sentence; the raw numbers stay in its tooltip.
test("a scenario row says what it serves and how fast, against its target", () => {
  const target = { p99Ms: 100, availability: 0.999 };
  expect(scenarioLine(row({}), target)).toBe(
    "Serves 98% · p99 140 ms (target 100 ms)",
  );
  expect(scenarioLine(row({ availability: 0.9995 }), target)).toBe(
    "Serves 99.95% · p99 140 ms (target 100 ms)",
  );
  expect(scenarioLine(row({ availability: 0, p99Ms: null }), target)).toBe(
    "Serves nothing yet",
  );
  expect(scenarioLine(row({ p99Ms: null }), undefined)).toBe(
    "Serves 98% · requests back up",
  );
});

// Q-WD-16: the Selected panel warns on the settings behind a hint about the component.
test("a database with no failover that goes down is flagged on its failover", () => {
  let d = starterDesign("1.0");
  for (const k of ["load_balancer", "app_service", "sql_db"] as const)
    d = addComponent(d, k, { x: 0, y: 0 });
  const [users, lb, app, db] = d.nodes.map((n) => n.id);
  if (
    db === undefined ||
    app === undefined ||
    lb === undefined ||
    users === undefined
  )
    throw new Error("nodes missing");
  d = connect(d, SHORTENER, users, lb);
  d = connect(d, SHORTENER, lb, app);
  d = connect(d, SHORTENER, app, db);
  const node = d.nodes.find((n) => n.id === db);
  if (node === undefined) throw new Error("no database");
  const result = simulate(SHORTENER, d);
  const risk = risksOf(SHORTENER, result, node);
  expect(risk.fields.has("failover")).toBe(true);
  expect(risk.said.some((r) => r.startsWith("Goes down in"))).toBe(true);
});

// Spec 2.0: an external provider has nothing to set; its warnings say what to do instead.
test("an external provider that's down and fails its callers says to queue the work", () => {
  const otp = allPracticeProblems().find((x) => x.slug === "otp-login");
  if (otp === undefined) throw new Error("no otp-login practice problem");
  let d = starterDesign(otp.spec);
  for (const k of ["load_balancer", "app_service", "external_api"] as const)
    d = addComponent(d, k, { x: 0, y: 0 });
  const [users, lb, app, sms] = d.nodes.map((n) => n.id);
  if (
    users === undefined ||
    lb === undefined ||
    app === undefined ||
    sms === undefined
  )
    throw new Error("nodes missing");
  d = connect(d, otp, users, lb);
  d = connect(d, otp, lb, app);
  d = connect(d, otp, app, sms);
  // ADR-0053: MSG91's SMS, the cheapest in India, sent only the codes.
  d = setRoutes(d, app, sms, ["request_code"]);
  d = pickProvider(d, otp, sms, { provider: "msg91", channel: "sms" });
  const node = d.nodes.find((n) => n.id === sms);
  if (node === undefined) throw new Error("no provider");
  const risk = risksOf(otp, simulate(otp, d), node);
  expect(risk.fields.size).toBe(0);
  expect(risk.said).toContain(
    'Down in "The messaging provider is down for 10 minutes", and what calls it fails: hand that work to a queue so it waits.',
  );
});

// ADR-0053: the provider's own warnings: nothing picked, and fees over the budget.
test("an external provider says when nothing is picked, and when its fees blow the budget", () => {
  const otp = allPracticeProblems().find((x) => x.slug === "otp-login");
  if (otp === undefined) throw new Error("no otp-login practice problem");
  let d = starterDesign(otp.spec);
  for (const k of ["load_balancer", "app_service", "external_api"] as const)
    d = addComponent(d, k, { x: 0, y: 0 });
  const [users, lb, app, sms] = d.nodes.map((n) => n.id);
  if (
    users === undefined ||
    lb === undefined ||
    app === undefined ||
    sms === undefined
  )
    throw new Error("nodes missing");
  d = connect(d, otp, users, lb);
  d = connect(d, otp, lb, app);
  d = connect(d, otp, app, sms);
  const risk = (design: typeof d) => {
    const node = design.nodes.find((n) => n.id === sms);
    if (node === undefined) throw new Error("no provider");
    return risksOf(otp, simulate(otp, design), node);
  };
  const unpicked = risk(d);
  expect([...unpicked.fields].sort()).toEqual(["channel", "provider"]);
  expect(unpicked.said[0]).toBe(
    "Nothing picked that it can use: pick a provider and channel offered in India. Until then it does no work.",
  );
  const twilio = risk(
    pickProvider(d, otp, sms, { provider: "twilio", channel: "sms" }),
  );
  expect([...twilio.fields].sort()).toEqual(["channel", "provider"]);
  expect(twilio.said).toContainEqual(
    expect.stringMatching(
      /^The providers' fees take the design over budget: \$[\d,]+ a month, against a budget of \$[\d,]+\. Send this one \(Twilio SMS\) only what it delivers, or pick a cheaper provider or channel\.$/,
    ),
  );
});

// Owner, 2026-11-24: card fees answer to their own target, not the budget.
test("a payment provider says when its fees per payment are over their target", () => {
  const family = FAMILIES.find((f) => f.slug === "payment-processing");
  if (family === undefined) throw new Error("no payment-processing family");
  const pay = variant(
    family,
    "human",
    POOL["payment-processing"]?.human[0] ?? 1,
  ).problem;
  let d = starterDesign(pay.spec);
  for (const k of ["load_balancer", "app_service", "external_api"] as const)
    d = addComponent(d, k, { x: 0, y: 0 });
  const [users, lb, app, net] = d.nodes.map((n) => n.id);
  if (
    users === undefined ||
    lb === undefined ||
    app === undefined ||
    net === undefined
  )
    throw new Error("nodes missing");
  d = connect(d, pay, users, lb);
  d = connect(d, pay, lb, app);
  d = connect(d, pay, app, net);
  d = setRoutes(d, app, net, ["authorize", "capture"]);
  const risk = (provider: "stripe" | "paypal") => {
    const design = pickProvider(d, pay, net, { provider, channel: "card" });
    const node = design.nodes.find((n) => n.id === net);
    if (node === undefined) throw new Error("no provider");
    return risksOf(pay, simulate(pay, design), node);
  };
  expect(risk("stripe").said.join(" ")).not.toMatch(/fees per payment/i);
  const paypal = risk("paypal");
  expect([...paypal.fields].sort()).toEqual(["channel", "provider"]);
  expect(paypal.said[0]).toBe(
    "Its fees per payment are over their target: PayPal charges $1.69 a payment, against $1.46. A cheaper processor would meet it.",
  );
});

// Spec 2.1: a coordinator in one zone loses its quorum with that zone, and its warning
// points at where its members are.
test("a coordination service that loses its quorum points at its zones and members", () => {
  const ids = allPracticeProblems().find((x) => x.slug === "id-generator");
  if (ids === undefined) throw new Error("no id-generator practice problem");
  let d = starterDesign(ids.spec);
  for (const k of ["load_balancer", "app_service", "coordination"] as const)
    d = addComponent(d, k, { x: 0, y: 0 });
  const [users, lb, app, coord] = d.nodes.map((n) => n.id);
  if (
    users === undefined ||
    lb === undefined ||
    app === undefined ||
    coord === undefined
  )
    throw new Error("nodes missing");
  d = connect(d, ids, users, lb);
  d = connect(d, ids, lb, app);
  d = connect(d, ids, app, coord);
  const node = d.nodes.find((n) => n.id === coord);
  if (node === undefined) throw new Error("no coordinator");
  const risk = risksOf(ids, simulate(ids, d), node);
  expect([...risk.fields].sort()).toEqual(["members", "regions", "zones"]);
  expect(risk.said).toContain(
    'Loses its quorum in "A zone goes down": no one zone or region may hold a majority of its members.',
  );
});

test("an external provider's face says who it is, once picked", () => {
  let d = addComponent(starterDesign("2.0"), "external_api", { x: 0, y: 0 });
  const node = d.nodes[1];
  if (node === undefined) throw new Error("no provider");
  expect(nodeRole(node)).toBe("third party");
  d = updateNode(d, node.id, { config: { provider: "msg91", channel: "sms" } });
  expect(nodeRole(d.nodes[1] ?? node)).toBe("MSG91 SMS");
});

test("2.1's kinds and a batch read as their size on a node's face", () => {
  const at = { x: 0, y: 0 };
  let d = starterDesign("2.1");
  for (const k of [
    "geo_index",
    "connection_gateway",
    "coordination",
    "worker",
  ] as const)
    d = addComponent(d, k, at);
  const roles = d.nodes
    .slice(1)
    .map((n) =>
      nodeRole(
        n.kind === "worker" ? { ...n, config: { ...n.config, batch: 100 } } : n,
      ),
    );
  expect(roles).toEqual([
    "1 shard",
    "1 node",
    "3 members · 1 zone",
    "1 node · batches of 100",
  ]);
});
