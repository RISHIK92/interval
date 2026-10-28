import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { paths, preferences, sessionReader } from "../../server/container";
import type { PathSummary } from "../../server/ports";
import { TabBar } from "../TabBar";
import { Card } from "../ui/Card";
import { startPathAction } from "./actions";

export const dynamic = "force-dynamic";

// §4, §5F, Q-P2-27 (P2-W10-S03): the Paths tab. The owner's live topic paths; the
// user's active one first, to continue. Start makes a path active (pausing another).
export default async function PathsPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const all = await paths().live(actor.userId);
  const active = all.filter((p) => p.mine === "active");
  const rest = all.filter((p) => p.mine !== "active");
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-[52rem] lg:pt-10 lg:pl-64">
      <h1 className="text-display">Paths</h1>
      <TabBar current="paths" firstName={chosen.firstName} />
      {all.length === 0 ? (
        <Card className="p-8 text-center text-ink-muted">
          <p>No paths yet. Guided paths through a topic arrive here soon.</p>
        </Card>
      ) : (
        <>
          {active.map((p) => (
            <section key={p.pathId} aria-label="Your path">
              <h2 className="mb-3 text-section">Your path</h2>
              <Card className="flex flex-col gap-3 p-5">
                <PathHead path={p} />
                <Link
                  href={`/paths/${p.pathId}`}
                  className="self-start rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
                >
                  Continue
                </Link>
              </Card>
            </section>
          ))}
          <section aria-label="All paths" className="flex flex-col gap-3">
            <h2 className="text-section">
              {active.length > 0 ? "Other paths" : "Pick a path"}
            </h2>
            <ul className="flex flex-col gap-3">
              {rest.map((p) => (
                <li key={p.pathId}>
                  <Card className="flex flex-col gap-3 p-5">
                    <PathHead path={p} />
                    <div className="flex items-center gap-3">
                      {p.retired ? (
                        <span className="text-sm font-semibold text-ink-muted">
                          Retired
                        </span>
                      ) : (
                        <form action={startPathAction}>
                          <input type="hidden" name="pathId" value={p.pathId} />
                          <button
                            type="submit"
                            className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
                          >
                            {p.mine === "paused" ? "Resume" : "Start"}
                          </button>
                        </form>
                      )}
                      <Link
                        href={`/paths/${p.pathId}`}
                        className="text-sm font-semibold text-select"
                      >
                        See the path
                      </Link>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

function PathHead({ path }: { path: PathSummary }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-title">{path.name}</h3>
      <p className="text-ink-muted">{path.why}</p>
      <p className="text-sm text-ink-muted">
        {path.sections} sections · {path.readings} readings · about{" "}
        {path.minutes} min
      </p>
    </div>
  );
}
