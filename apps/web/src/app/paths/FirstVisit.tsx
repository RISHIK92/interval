import Link from "next/link";
import type { Topic } from "@interval/db";
import type { PathSummary, PathTimeline } from "../../server/ports";
import { Card } from "../ui/Card";
import { TopicArt } from "../ui/TopicArt";
import { startPathAction } from "./actions";
import { ShowPicked } from "./ShowPicked";
import { UploadDrop } from "./UploadDrop";

// The Paths tab before anything is added (wireframe "Web · Paths, first visit"): bring
// your own PDF, or start a ready-made topic path, previewed on the right. The wireframe
// is UI only (CLAUDE.md): what it shows that isn't built is left out.
export function FirstVisit({
  paths,
  topic,
  preview,
  guest,
  maxMb,
}: {
  paths: PathSummary[];
  topic: Topic | null; // the chip filter, from ?topic=
  preview: PathTimeline | null; // from ?preview=
  guest: boolean;
  maxMb: number | null; // the plan's PDF size limit (OPS-3), shown before upload
}) {
  const topics = [
    ...new Set(paths.flatMap((p) => (p.topic === null ? [] : [p.topic]))),
  ];
  const shown = topic === null ? paths : paths.filter((p) => p.topic === topic);
  const href = (params: { topic?: Topic | null; preview?: string }) => {
    const query = new URLSearchParams();
    if (params.topic) query.set("topic", params.topic);
    if (params.preview) query.set("preview", params.preview);
    const text = query.toString();
    return text ? `/paths?${text}` : "/paths";
  };
  return (
    // A picked path opens in a wide pane on the right; the list narrows to one column
    // and the upload steps aside (owner, 2026-10-29).
    <div
      className={`flex flex-col gap-6 lg:grid lg:gap-8 ${
        preview === null
          ? "lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start"
          : "lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,49fr)_minmax(0,51fr)] lg:grid-rows-[minmax(0,1fr)]"
      }`}
    >
      {/* With a path open (owner, 2026-10-29): each side scrolls on its own, and the
      other paths dim until the cursor or focus is on the list. */}
      <div
        className={`group/list flex min-w-0 flex-col gap-6 ${
          preview === null
            ? ""
            : // Negative margins with matching padding: the scrollbar sits out in the
              // gap, the picked card's ring isn't clipped, the cards keep their place.
              "lg:-mr-6 lg:-ml-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-8 lg:pb-1 lg:pl-1"
        }`}
      >
        <header>
          <h1 className="text-display">Paths</h1>
          <p className="mt-1 text-ink-muted">
            No paths yet. Add something you already want to read, or start from
            a ready-made path. Either way it becomes short sessions.
          </p>
        </header>
        {preview !== null ? null : (
          <Card className="overflow-hidden">
            <HeroArt />
            <section aria-label="Bring your own reading" className="p-5">
              <h2 className="text-title">Bring your own reading</h2>
              <p className="mt-1 text-sm text-ink-muted">
                We split it into short sessions, with a 60-second checkpoint
                after each chapter.
              </p>
              <div className="mt-4">
                {guest ? (
                  <Link
                    href="/join"
                    className="inline-block rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
                  >
                    Create an account to add a book
                  </Link>
                ) : (
                  <UploadDrop maxMb={maxMb} />
                )}
              </div>
            </section>
          </Card>
        )}
        <section aria-label="Ready-made paths" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-section">Or start a ready-made path</h2>
            {paths.length > 0 ? (
              <p className="text-sm text-ink-muted">
                Pick one to preview it on the right
              </p>
            ) : null}
          </div>
          {paths.length === 0 ? (
            <Card className="p-8 text-center text-ink-muted">
              <p>Guided paths through a topic arrive here soon.</p>
            </Card>
          ) : (
            <>
              {topics.length > 0 ? (
                <nav
                  aria-label="Filter by topic"
                  className="flex flex-wrap gap-2"
                >
                  {[null, ...topics].map((t) => (
                    <Link
                      key={t ?? "all"}
                      href={href({ topic: t })}
                      aria-current={t === topic ? "true" : undefined}
                      className={`rounded-full border px-3 py-1.5 text-sm ${
                        t === topic
                          ? "border-ink font-semibold"
                          : "border-hairline text-ink-muted"
                      }`}
                    >
                      {t === null ? "All" : `#${t}`}
                    </Link>
                  ))}
                </nav>
              ) : null}
              <ul
                className={`grid gap-3 ${preview === null ? "sm:grid-cols-2" : ""}`}
              >
                {shown.map((p) => (
                  <li
                    key={p.pathId}
                    id={`path-${p.pathId}`}
                    className={
                      preview === null || preview.pathId === p.pathId
                        ? ""
                        : "transition-opacity lg:opacity-40 lg:group-focus-within/list:opacity-100 lg:group-hover/list:opacity-100"
                    }
                  >
                    <Link
                      // The anchor keeps the picked card in view in its own scroll.
                      href={`${href({ topic, preview: p.pathId })}#path-${p.pathId}`}
                      aria-current={
                        preview?.pathId === p.pathId ? "true" : undefined
                      }
                      className="block h-full overflow-hidden rounded-3xl border border-hairline bg-page aria-[current=true]:border-select aria-[current=true]:ring-2 aria-[current=true]:ring-select"
                    >
                      {p.topic === null ? null : (
                        <TopicArt
                          topic={p.topic}
                          className="block h-28 w-full"
                        />
                      )}
                      <span className="flex flex-col gap-1 p-4">
                        {p.topic === null ? null : (
                          <span className="text-xs font-semibold text-ink-muted">
                            #{p.topic}
                          </span>
                        )}
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-sm text-ink-muted">
                          {p.sections} sections · about {p.minutes} min
                        </span>
                        <span className="mt-2 flex items-center gap-2 text-sm">
                          <span className="font-semibold">
                            {p.readings} sessions
                          </span>
                          {p.fitsGoal ? (
                            <span className="rounded-md bg-well px-2 py-0.5 text-xs">
                              Fits your goal
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
      {preview === null ? (
        <PathRail />
      ) : (
        <>
          <PathPane path={preview} close={href({ topic })} />
          <ShowPicked pathId={preview.pathId} paneId={PICKED_PANE} />
        </>
      )}
    </div>
  );
}

// The right rail before a path is picked: how a path works, where its plan will
// show, and the phone note.
function PathRail() {
  const steps: [string, string][] = [
    ["Add a book, or pick a path", "Something you already meant to read."],
    ["Read in short sessions", "Short enough for a break, on web or phone."],
    ["Pass a 60-second checkpoint", "It opens the next section."],
  ];
  return (
    <aside aria-label="How paths work" className="flex flex-col gap-3">
      <Card className="p-4">
        <h2 className="font-semibold">How a path works</h2>
        <ol className="mt-3 flex flex-col gap-3">
          {steps.map(([title, detail], index) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-well text-xs font-semibold">
                {index + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-sm text-ink-muted">{detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <div className="rounded-3xl border border-dashed border-hairline p-4">
        <h2 className="font-semibold">Your plan shows up here</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Pick a path or add a book to see its plan here.
        </p>
      </div>
      <div className="rounded-3xl bg-well p-4">
        <h2 className="font-semibold">Read on your phone too</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Your place in a book is saved. Stop here, pick up on your phone.
        </p>
      </div>
    </aside>
  );
}

const PICKED_PANE = "picked-path";

// The picked path: a pane on the right on wide screens, a sheet over the paths on a
// phone (owner, 2026-10-29). Its sections and their readings, to start.
function PathPane({ path, close }: { path: PathTimeline; close: string }) {
  return (
    <aside
      id={PICKED_PANE}
      tabIndex={-1}
      aria-label={`Path: ${path.name}`}
      className="fixed inset-0 z-20 overflow-y-auto overscroll-contain bg-ink/40 px-4 pt-16 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none lg:static lg:z-auto lg:bg-transparent lg:p-0"
    >
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-title">{path.name}</h2>
          <Link
            href={close}
            aria-label="Close the path"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
        </div>
        <p className="text-ink-muted">{path.why}</p>
        <ol className="flex flex-col gap-3">
          {path.sections.map((section, index) => (
            <li
              key={section.sectionId}
              className="rounded-2xl border border-hairline p-4"
            >
              <p className="font-semibold">
                Section {index + 1}
                <span className="font-normal text-ink-muted">
                  {" "}
                  · {section.concepts.join(", ")}
                </span>
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {section.readings.map((reading) => (
                  <li key={reading.momentId} className="text-ink-muted">
                    {reading.sectionTitle} · {reading.sourceName} ·{" "}
                    {reading.minutes} min
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-muted">
                Then a 60-second checkpoint
              </p>
            </li>
          ))}
        </ol>
        {path.retired ? null : (
          <form action={startPathAction}>
            <input type="hidden" name="pathId" value={path.pathId} />
            <button
              type="submit"
              className="w-full cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
            >
              Start this path
            </button>
          </form>
        )}
      </Card>
    </aside>
  );
}

// A book becoming sessions: one block, then its short pieces (decorative).
function HeroArt() {
  const tint = "var(--system-design-tint)";
  const right = "var(--system-design-right)";
  const cube = (x: number) => (
    <path
      key={x}
      d={`M${String(x)} 62 l14 -7 l14 7 v16 l-14 7 l-14 -7 z`}
      fill={right}
    />
  );
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 120"
      className="block h-40 w-full"
      style={{ background: tint }}
    >
      <path d="M40 58 l50 -22 l50 22 l-50 22 z" fill={right} opacity="0.7" />
      <path
        d="M40 58 v14 l50 22 v-14 z M140 58 v14 l-50 22 v-14 z"
        fill={right}
      />
      <path
        d="M150 70 h20"
        stroke={right}
        strokeWidth="3"
        strokeDasharray="4 4"
      />
      {[180, 210, 240].map(cube)}
      <path
        d="M270 62 l14 -7 l14 7 v16 l-14 7 l-14 -7 z"
        fill="none"
        stroke={right}
        strokeDasharray="3 3"
      />
    </svg>
  );
}
