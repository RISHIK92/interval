import type { LoadedProblem } from "../../../../server/ports";

// The visible tests as code: the constructor by its class, arguments as JSON, and after
// each call its expected value (when the method returns one) or that it fails.
export function examplesOf({
  interface: api,
  visible,
}: Pick<LoadedProblem, "interface" | "visible">): string[] {
  const returning = new Set(
    api.methods.filter((m) => m.returns !== "void").map((m) => m.name),
  );
  return visible.map((v) =>
    v.scenario.calls
      .map((c, i) => {
        const name = c.method === "new" ? api.class : c.method;
        const args = c.args.map((a) => JSON.stringify(a)).join(", ");
        const line = v.results.find((r) => r.call === i);
        const shown =
          line === undefined
            ? ""
            : "error" in line
              ? " → fails"
              : c.method !== "new" && returning.has(c.method)
                ? ` → ${JSON.stringify(line.value)}`
                : "";
        return `${name}(${args})${shown}`;
      })
      .join("\n"),
  );
}
