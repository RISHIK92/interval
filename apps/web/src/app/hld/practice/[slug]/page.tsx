import {
  Design,
  fitsProblem,
  practiceProblems,
  starterDesign,
} from "@interval/hld";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  entitlements,
  hldJudgements,
  hldPracticeDesigns,
  sessionReader,
} from "../../../../server/container";
import { feedbackView } from "../feedback";
import { Canvas } from "../../Canvas";
import { Cube } from "../../flow";
import { FRAME, HEADER, HEADER_TILE, Requirements, TITLE } from "../../Frame";

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
  const [saved, latest] = await Promise.all([
    hldPracticeDesigns().load(actor.userId, slug),
    hldJudgements().latest(actor.userId, slug),
  ]);
  const parsed = Design.safeParse(saved?.design);
  return (
    <main className={FRAME}>
      <header className={HEADER}>
        <Link
          href="/hld/practice"
          aria-label="Back to practice"
          className="hidden size-11 shrink-0 items-center justify-center rounded-xl border-[1.5px] text-ink lg:flex lg:border-hairline-strong"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </Link>
        <span className={HEADER_TILE}>
          <Cube size={30} ramp="system-design" />
        </span>
        <div className="lg:min-w-[200px] lg:flex-1">
          <p className="hidden text-[13px] text-ink-muted lg:block">
            HLD practice
          </p>
          <h1 className={TITLE}>{problem.title}</h1>
        </div>
      </header>
      <Requirements requirements={problem.requirements} />
      <Canvas
        problem={problem}
        initial={
          parsed.success && fitsProblem(parsed.data, problem).length === 0
            ? parsed.data
            : starterDesign()
        }
        version={saved?.version ?? 0}
        mode={{
          kind: "practice",
          feedback: latest === null ? null : feedbackView(latest),
        }}
      />
    </main>
  );
}
