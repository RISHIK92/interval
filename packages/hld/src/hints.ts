import type { HldProblem } from "./problem";
import type { SimulationResult } from "./simulate";

// P6-W39 (Q-P6-03): the canvas's hints, by rule from the preview simulation; no model
// calls. The most serious first, at most MAX_HINTS, each naming what to look at, never
// the fix's numbers.
const MAX_HINTS = 5;

// "a", "a and b", "a, b and c".
const list = (ids: string[]) =>
  ids.length <= 1
    ? ids.join("")
    : `${ids.slice(0, -1).join(", ")} and ${ids.slice(-1).join("")}`;

export function hints(problem: HldProblem, result: SimulationResult): string[] {
  if (result.scenarios.length === 0) return result.explanations.slice(0, 1);
  const found: string[] = [];
  const add = (hint: string) => {
    if (!found.includes(hint)) found.push(hint);
  };
  const baseline = result.scenarios.find((s) => s.id === "baseline");
  for (const t of baseline?.types ?? [])
    if (t.availability === 0)
      add(
        `"${t.type}" requests aren't served: route them on to where the work is done.`,
      );
  if (!result.writesKept)
    add("No write is kept: route writes to a database or store.");
  const overloaded = new Set<string>();
  for (const s of result.scenarios)
    for (const n of s.nodes)
      if (
        n.up &&
        n.utilization !== null &&
        n.utilization >= 1 &&
        !overloaded.has(n.id)
      ) {
        overloaded.add(n.id);
        add(`${n.id} is overloaded in "${s.name}": it needs more capacity.`);
      }
  for (const s of result.scenarios) {
    const down = s.nodes.filter((n) => !n.up).map((n) => n.id);
    if (down.length > 0)
      add(
        `In "${s.name}", ${list(down)} ${down.length === 1 ? "goes" : "go"} down: nothing covers for ${down.length === 1 ? "it" : "them"}.`,
      );
  }
  if (result.storageGb !== null && result.storageGb < result.storageNeededGb)
    add(
      `Storage runs out: ${String(result.storageNeededGb)} GB is needed by the end.`,
    );
  if (result.costPerMonth > problem.budgetPerMonth)
    add("The design is over budget: look for capacity it doesn't use.");
  const hot = new Set<string>();
  for (const s of result.scenarios)
    for (const n of s.nodes)
      if (
        n.utilization !== null &&
        n.utilization > 0.8 &&
        n.utilization < 1 &&
        !hot.has(n.id) &&
        !overloaded.has(n.id)
      ) {
        hot.add(n.id);
        add(`${n.id} runs hot in "${s.name}": waits grow fast past 80%.`);
      }
  return found.slice(0, MAX_HINTS);
}
