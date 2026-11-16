import type { JudgeInput } from "@interval/hld";

// P6-W41 (CANVAS-6): a design as the AI judge saw it, for the owner grading it at
// /admin/hld-appeals and /admin/hld-calibration: components with their notes,
// connections, and the simulation's results.
export function JudgedDesign({ input }: { input: JudgeInput }) {
  const s = input.simulation;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-semibold">{input.title}</p>
      <ul className="flex flex-col gap-1">
        {input.components.map((c) => (
          <li key={c.id}>
            <code>
              {c.id} ({c.kind}) {JSON.stringify(c.config)}
            </code>
            {c.note === "" ? null : (
              <span className="block whitespace-pre-wrap text-ink-muted">
                {c.note}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-ink-muted">
        {input.connections
          .map((c) => `${c.from} → ${c.to} (${c.carries.join(", ")})`)
          .join(" · ")}
      </p>
      <p>
        {s.points} of 60 simulation points · baseline{" "}
        {s.baselinePassed ? "passed" : "not passed"} · $
        {Math.round(s.costPerMonth).toLocaleString("en-US")} of $
        {s.budgetPerMonth.toLocaleString("en-US")} a month
      </p>
    </div>
  );
}
