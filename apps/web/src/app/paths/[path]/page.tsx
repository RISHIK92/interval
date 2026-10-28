import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Chip } from "../../../server/chips";
import { paths, preferences, sessionReader } from "../../../server/container";
import { outHref, readHref } from "../../../server/outbound";
import { BIGINT_ID, type PathReading } from "../../../server/ports";
import { parseReading } from "../../../server/reading";
import { ReturnPrompt } from "../../ReturnPrompt";
import { TabBar } from "../../TabBar";
import { Card } from "../../ui/Card";
import { startCheckpointAction } from "../../quiz/actions";
import { startPathAction } from "../actions";

export const dynamic = "force-dynamic";

// §5F, wireframe 05, Q-P2-27 (P2-W10-S03): a path's timeline. Sections in order, each
// with its readings (finished ones ticked) and a checkpoint after it; locked sections
// say what unlocks them. A section's checkpoint opens once its readings are finished
// (P2-W10-S04). A reading opens in the reader (or the browser) as a path
// open, which comes back here and asks "Finished?".
export default async function PathPage(props: {
  params: Promise<{ path: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const { path: pathId } = await props.params;
  if (!BIGINT_ID.test(pathId)) redirect("/paths");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const chip = chosen.breakLength;
  const path = await paths().path(actor.userId, pathId);
  if (path === null) notFound();
  const params = await props.searchParams;
  const ask = parseReading(
    typeof params["ask"] === "string" ? params["ask"] : undefined,
  );
  const next = path.sections
    .filter((s) => s.open)
    .flatMap((s) => s.readings)
    .find((r) => !r.finished && !r.linkBroken);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-[52rem] lg:pt-10 lg:pl-64">
      <TabBar current="paths" firstName={chosen.firstName} />
      <header className="flex flex-col gap-2">
        <h1 className="text-display">{path.name}</h1>
        <p className="text-ink-muted">{path.why}</p>
        {path.retired ? (
          <p role="status" className="rounded-2xl bg-well px-4 py-3">
            This path was retired. Your progress stays, but it gets no updates.
          </p>
        ) : null}
        {path.mine !== "active" && !path.retired ? (
          <form action={startPathAction}>
            <input type="hidden" name="pathId" value={path.pathId} />
            <button
              type="submit"
              className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
            >
              {path.mine === "paused" ? "Resume this path" : "Start this path"}
            </button>
          </form>
        ) : null}
        {next === undefined ? null : (
          <p className="font-semibold">
            Next:{" "}
            <ReadingLink reading={next} pathId={path.pathId} chip={chip} />
          </p>
        )}
      </header>
      <ol className="flex flex-col gap-4">
        {path.sections.map((section, i) => {
          const after = path.sections[i + 1];
          return (
            <li key={section.sectionId} className="flex flex-col gap-3">
              <Card className="flex flex-col gap-3 p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-title">{section.concepts.join(", ")}</h2>
                  {section.open ? null : (
                    <span className="text-sm text-ink-muted">
                      Locked · unlocks after the{" "}
                      {path.sections[i - 1]?.concepts.join(", ")} checkpoint
                    </span>
                  )}
                </div>
                <ul className="flex flex-col gap-2">
                  {section.readings.map((r) => (
                    <li
                      key={r.momentId}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="min-w-0">
                        {section.open ? (
                          <ReadingLink
                            reading={r}
                            pathId={path.pathId}
                            chip={chip}
                          />
                        ) : (
                          <span className="font-semibold">
                            {r.sectionTitle}
                          </span>
                        )}{" "}
                        <span className="text-sm text-ink-muted">
                          · {r.articleTitle} · {r.minutes} min
                        </span>
                      </span>
                      {r.finished ? (
                        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold">
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className="size-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M5 12l5 5 9-10" />
                          </svg>
                          Finished
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2">
                <p className="flex items-center gap-2 text-sm text-ink-muted">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 21V4h11l-2 4 2 4H5" />
                  </svg>
                  {section.checkpoint === "passed"
                    ? "Checkpoint passed"
                    : section.size === 0
                      ? "Checkpoint"
                      : `Checkpoint · Pass ${String(section.passMark)} of ${String(section.size)} ${
                          after === undefined
                            ? "to finish the path"
                            : `to unlock ${after.concepts.join(", ")}`
                        }`}
                </p>
                {section.checkpoint === "ready" && path.mine === "active" ? (
                  <form action={startCheckpointAction}>
                    <input
                      type="hidden"
                      name="sectionId"
                      value={section.sectionId}
                    />
                    <input type="hidden" name="chip" value={chip} />
                    <input
                      type="hidden"
                      name="back"
                      value={`/paths/${path.pathId}`}
                    />
                    <button
                      type="submit"
                      className="cursor-pointer rounded-full bg-ink px-4 py-2 text-sm font-semibold text-page"
                    >
                      Take the checkpoint
                    </button>
                  </form>
                ) : section.checkpoint === "no_questions" ? (
                  <span className="text-sm text-ink-muted">
                    Checkpoint not ready yet
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <ReturnPrompt chip={chip} initialAsk={ask} back={`/paths/${path.pathId}`}>
        {null}
      </ReturnPrompt>
    </main>
  );
}

// A reading in the in-app reader when its page can be framed, else in the browser
// through /out; both count as a path open (no feed event) and lead back here.
function ReadingLink(props: {
  reading: PathReading;
  pathId: string;
  chip: Chip;
}) {
  const { reading: r, pathId, chip } = props;
  if (r.linkBroken)
    return (
      <span className="font-semibold text-ink-muted">
        {r.sectionTitle} (link broken)
      </span>
    );
  const className = "font-semibold text-select";
  return r.frameable ? (
    <a
      href={readHref({
        itemId: r.itemId,
        momentId: r.momentId,
        chip,
        from: { path: pathId },
      })}
      className={className}
    >
      {r.sectionTitle}
    </a>
  ) : (
    <a
      href={outHref({
        itemId: r.itemId,
        momentId: r.momentId,
        from: "path",
        target: "section",
      })}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {r.sectionTitle}
    </a>
  );
}
