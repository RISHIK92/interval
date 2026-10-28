import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Chip } from "../../../server/chips";
import { paths, preferences, sessionReader } from "../../../server/container";
import { outHref, readHref } from "../../../server/outbound";
import {
  BIGINT_ID,
  type PathAlternative,
  type PathReading,
} from "../../../server/ports";
import { parseReading } from "../../../server/reading";
import { ReturnPrompt } from "../../ReturnPrompt";
import { TabBar } from "../../TabBar";
import { Card } from "../../ui/Card";
import { startCheckpointAction } from "../../quiz/actions";
import { editPathAction, startPathAction } from "../actions";

export const dynamic = "force-dynamic";

// §5F, wireframe 05, Q-P2-27 (P2-W10-S03): a path's timeline. Sections in order, each
// with its readings (finished ones ticked) and a checkpoint after it; locked sections
// say what unlocks them. A section's checkpoint opens once its readings are finished
// (P2-W10-S04). A reading opens in the reader (or the browser) as a path
// open, which comes back here and asks "Finished?". Edit (P2-W10-S05, C-25, Q-P2-23)
// changes the user's own copy: pause, move, skip or unskip, swap a reading.
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
  // Edits are for a follower of a live path; ?swap=<section>.<ordinal> lists one
  // reading's alternatives.
  const editable = path.mine !== null && !path.retired;
  const editing = editable && params["edit"] === "1";
  const swap =
    editing && typeof params["swap"] === "string"
      ? /^(\d{1,18})\.(\d{1,4})$/.exec(params["swap"])
      : null;
  // An ordinal is a smallint: anything larger names no session.
  const swapping =
    swap?.[1] === undefined || swap[2] === undefined || Number(swap[2]) > 32767
      ? null
      : {
          sectionId: swap[1],
          ordinal: Number(swap[2]),
          options: await paths().alternatives(
            actor.userId,
            swap[1],
            Number(swap[2]),
          ),
        };
  const here = `/paths/${path.pathId}`;
  const next = path.sections
    .filter((s) => s.open && !s.skipped)
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
        {editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={editing ? here : `${here}?edit=1`}
              className="text-sm font-semibold text-select"
            >
              {editing ? "Done editing" : "Edit path"}
            </a>
            {editing && path.mine === "active" ? (
              <form action={editPathAction}>
                <input type="hidden" name="edit" value="pause" />
                <input type="hidden" name="pathId" value={path.pathId} />
                <button type="submit" className={SECONDARY}>
                  Pause this path
                </button>
              </form>
            ) : null}
          </div>
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
          const blocker = path.sections
            .slice(0, i)
            .findLast((s) => s.holdsBack);
          return (
            <li key={section.sectionId} className="flex flex-col gap-3">
              <Card className="flex flex-col gap-3 p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-title">{section.concepts.join(", ")}</h2>
                  {section.open ? null : (
                    <span className="text-sm text-ink-muted">
                      Locked · unlocks after the {blocker?.concepts.join(", ")}{" "}
                      checkpoint
                    </span>
                  )}
                </div>
                {section.warning === null ? null : (
                  <p className="text-sm text-ink-muted">
                    Moved ahead of {section.warning.join(", ")}, which this path
                    teaches first.
                  </p>
                )}
                {editing ? (
                  <SectionControls
                    sectionId={section.sectionId}
                    name={section.concepts.join(", ")}
                    first={i === 0}
                    last={after === undefined}
                    skippable={
                      section.checkpoint !== "passed" && !section.skipped
                    }
                    skipped={section.skipped}
                  />
                ) : null}
                <ul className="flex flex-col gap-2">
                  {section.readings.map((r) => (
                    <li key={r.momentId} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-3">
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
                        ) : editing ? (
                          <a
                            href={`${here}?edit=1&swap=${section.sectionId}.${String(r.ordinal)}`}
                            aria-label={`Swap ${r.sectionTitle}`}
                            className={SECONDARY}
                          >
                            Swap
                          </a>
                        ) : null}
                      </div>
                      {swapping?.sectionId === section.sectionId &&
                      swapping.ordinal === r.ordinal ? (
                        <SwapList
                          sectionId={section.sectionId}
                          ordinal={r.ordinal}
                          title={r.sectionTitle}
                          options={swapping.options}
                        />
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
                    : section.checkpoint === "skipped"
                      ? "Skipped · no checkpoint"
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

const SECONDARY =
  "cursor-pointer rounded-full border border-hairline px-3 py-1.5 text-sm font-semibold";

function SectionControls(props: {
  sectionId: string;
  name: string;
  first: boolean;
  last: boolean;
  skippable: boolean;
  skipped: boolean;
}) {
  const confirm = `skip-${props.sectionId}`;
  return (
    <div className="flex flex-wrap gap-2">
      {props.first ? null : (
        <Edit
          sectionId={props.sectionId}
          edit="up"
          name={`Move ${props.name} up`}
        >
          ↑ Up
        </Edit>
      )}
      {props.last ? null : (
        <Edit
          sectionId={props.sectionId}
          edit="down"
          name={`Move ${props.name} down`}
        >
          ↓ Down
        </Edit>
      )}
      {props.skipped ? (
        <Edit
          sectionId={props.sectionId}
          edit="unskip"
          name={`Unskip ${props.name}`}
        >
          Unskip
        </Edit>
      ) : props.skippable ? (
        <>
          {/* A native popover asks first: no script, no browser dialog. */}
          <button
            type="button"
            popoverTarget={confirm}
            aria-label={`Skip section ${props.name}`}
            className={SECONDARY}
          >
            Skip section
          </button>
          <div
            id={confirm}
            popover="auto"
            role="alertdialog"
            aria-labelledby={`${confirm}-title`}
            className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-page p-5 text-ink shadow-card backdrop:bg-black/40"
          >
            <p id={`${confirm}-title`} className="font-semibold">
              Skip {props.name}?
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              The next section opens. Skipping doesn&apos;t mark these concepts
              practiced; you can unskip it later.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <form action={editPathAction}>
                <input type="hidden" name="edit" value="skip" />
                <input type="hidden" name="sectionId" value={props.sectionId} />
                <button
                  type="submit"
                  className="w-full cursor-pointer rounded-full border border-wrong px-5 py-3 font-semibold"
                >
                  Skip section
                </button>
              </form>
              <button
                type="button"
                autoFocus
                popoverTarget={confirm}
                popoverTargetAction="hide"
                className="w-full cursor-pointer rounded-full bg-ink px-5 py-3 font-semibold text-page"
              >
                Keep it
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Edit(props: {
  sectionId: string;
  edit: "up" | "down" | "unskip";
  name: string;
  children: string;
}) {
  return (
    <form action={editPathAction}>
      <input type="hidden" name="sectionId" value={props.sectionId} />
      <button
        type="submit"
        name="edit"
        value={props.edit}
        aria-label={props.name}
        className={SECONDARY}
      >
        {props.children}
      </button>
    </form>
  );
}

function SwapList(props: {
  sectionId: string;
  ordinal: number;
  title: string;
  options: PathAlternative[];
}) {
  if (props.options.length === 0)
    return (
      <p className="text-sm text-ink-muted">
        No other reading on these concepts to swap in yet.
      </p>
    );
  return (
    <ul
      className="flex flex-col gap-2 rounded-2xl bg-well p-3"
      aria-label={`Swap ${props.title} for`}
    >
      {props.options.map((o) => (
        <li
          key={o.momentId}
          className="flex items-center justify-between gap-3"
        >
          <span className="min-w-0 text-sm">
            <span className="font-semibold">{o.sectionTitle}</span>{" "}
            <span className="text-ink-muted">
              · {o.articleTitle} · {o.sourceName} · {o.minutes} min
            </span>
          </span>
          <form action={editPathAction}>
            <input type="hidden" name="edit" value="swap" />
            <input type="hidden" name="sectionId" value={props.sectionId} />
            <input type="hidden" name="ordinal" value={props.ordinal} />
            <input type="hidden" name="momentId" value={o.momentId} />
            <button
              type="submit"
              aria-label={`Use this: ${o.sectionTitle}`}
              className={SECONDARY}
            >
              Use this
            </button>
          </form>
        </li>
      ))}
    </ul>
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
