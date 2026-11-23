import {
  addComponent,
  connect,
  practiceProblems,
  type ScenarioResult,
  simulate,
  starterDesign,
} from "@interval/hld";
import { expect, test } from "vitest";
import { risksOf, scenarioLine } from "./Canvas";

const SHORTENER = (() => {
  const p = practiceProblems().find((x) => x.slug === "url-shortener");
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
  let d = starterDesign();
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
