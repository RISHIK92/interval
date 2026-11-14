import { practiceProblems } from "@interval/hld";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { entitlements, sessionReader } from "../../../server/container";

export const dynamic = "force-dynamic";

// P6-W39 (ADR-0042 PROPOSED): HLD practice. Design a system for a problem on the
// canvas, with its simulation live as it's drawn; no clock, no opponent.
export default async function PracticePage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-12">
      <header>
        <h1 className="text-display">System design practice</h1>
        <p className="mt-1 text-ink-muted">
          Build a design from the{" "}
          <Link href="/hld/spec" className="underline">
            spec sheet&apos;s components
          </Link>{" "}
          and watch it run through each scenario as you draw. Best on a desktop
          browser.
        </p>
      </header>
      <ul className="flex flex-col gap-3">
        {practiceProblems().map((p) => (
          <li key={p.slug} className="rounded-md border border-line p-3">
            <Link
              href={`/hld/practice/${p.slug}`}
              className="text-title underline"
            >
              {p.title}
            </Link>
            <p className="mt-1 text-sm text-ink-muted">
              {p.requirements.join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
