import {
  Design,
  fitsProblem,
  practiceProblems,
  starterDesign,
} from "@interval/hld";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  entitlements,
  hldPracticeDesigns,
  sessionReader,
} from "../../../../server/container";
import { Canvas } from "./Canvas";

export const dynamic = "force-dynamic";

// P6-W39 (CANVAS-1, CANVAS-2, ADR-0042 PROPOSED): one practice problem on the canvas,
// from the player's last autosave. A saved design that no longer parses (its spec
// version retired) or no longer fits the problem (its components or request types
// changed) starts over from the client, at the saved version so the next save replaces
// it.
export default async function PracticeProblemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const { slug } = await params;
  const problem = practiceProblems().find((p) => p.slug === slug);
  if (problem === undefined) notFound();
  const saved = await hldPracticeDesigns().load(actor.userId, slug);
  const parsed = Design.safeParse(saved?.design);
  return (
    <main className="flex flex-col gap-4 px-4 pt-6 pb-12">
      <header className="mx-auto w-full max-w-6xl">
        <h1 className="text-display">{problem.title}</h1>
        <ul className="mt-1 list-disc pl-5 text-ink-muted">
          {problem.requirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </header>
      <Canvas
        problem={problem}
        initial={
          parsed.success && fitsProblem(parsed.data, problem).length === 0
            ? parsed.data
            : starterDesign()
        }
        version={saved?.version ?? 0}
      />
    </main>
  );
}
