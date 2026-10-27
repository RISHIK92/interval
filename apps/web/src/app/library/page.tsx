import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  library,
  notes,
  preferences,
  sessionReader,
  quizzes,
} from "../../server/container";
import type { Chip } from "../../server/chips";
import { outHref, readHref } from "../../server/outbound";
import type { HistoryItem, NoteEntry, SavedItem } from "../../server/ports";
import { parseReading } from "../../server/reading";
import { NoteBox } from "../NoteBox";
import { ReturnPrompt } from "../ReturnPrompt";
import { TabBar } from "../TabBar";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { startReviewAction } from "../quiz/actions";
import { libraryUnsaveAction } from "./actions";

// About 20 seconds a question: the review queue's time estimate (wireframe 08).
const REVIEW_SECONDS_EACH = 20;

export const dynamic = "force-dynamic";

const LIMIT = 50;

// The Library tab (§4.1, §5I, C-06, Q-P1-19, P1-W5-S05): what you saved and what you
// finished (owner: finished, not opened). Everything, hidden sources included: it is
// the reader's own record, not the feed.
// The link follows the reader (owner, 2026-10-26): Continue reading at the first
// unfinished section, Open article when none is done, Read again from the top when
// finished. In Interval's reader when the page can be framed (ADR-0018), marked so
// Back asks; else the browser. Unless the weekly check found the page gone
// (P1-W6-S03): the item stays listed so the reader knows why it left the feed.
function ReadLink(props: { item: SavedItem | HistoryItem; chip: Chip }) {
  const { item, chip } = props;
  const momentId =
    !item.finished && item.finishedSections > 0
      ? (item.nextMomentId ?? undefined)
      : undefined;
  const label = item.finished
    ? "Read again"
    : momentId === undefined
      ? "Open article"
      : "Continue reading";
  return (
    <LibraryLink
      itemId={item.itemId}
      momentId={momentId}
      label={label}
      name={`${label}: ${item.articleTitle}`}
      frameable={item.frameable}
      linkBroken={item.linkBroken}
      chip={chip}
    />
  );
}

// A link out of the Library to a section (or the article) on the publisher's page:
// the in-app reader when it can frame it, else the browser through /out.
function LibraryLink(props: {
  itemId: string;
  momentId: string | undefined;
  label: string;
  name: string;
  frameable: boolean;
  linkBroken: boolean;
  chip: Chip;
}) {
  const { itemId, momentId, label, name, chip } = props;
  if (props.linkBroken)
    return <p className="text-sm text-ink-muted">Link broken</p>;
  const at = momentId === undefined ? {} : { momentId };
  const className = "text-sm font-semibold text-select";
  return props.frameable ? (
    <a
      href={readHref({ itemId, ...at, chip, from: "library" })}
      data-read-item={itemId}
      data-read-moment={momentId}
      aria-label={name}
      className={className}
    >
      {label}
    </a>
  ) : (
    <a
      href={outHref({
        itemId,
        ...at,
        from: "library",
        target: momentId === undefined ? "original" : "section",
      })}
      data-item={itemId}
      data-moment={momentId}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={name}
      className={className}
    >
      {label}
    </a>
  );
}

const icon = (path: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-6"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);

// Highlights and audio come with later phases (owner, 2026-10-26): shown, dimmed, so the
// shelf has its final shape. Notes came in P2-W7-S04.
const LATER = [
  { label: "Highlights", icon: icon(<path d="M4 20h6M14 4l6 6-9 9H5v-6z" />) },
  {
    label: "Audio",
    icon: icon(
      <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3z" />,
    ),
  },
];

const TILE = "flex flex-col gap-2 rounded-2xl bg-well p-4";

function Row(props: {
  title: string;
  source: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <li className={`flex flex-col gap-2 px-5 py-4 ${props.className ?? ""}`}>
      <p>
        <span className="font-semibold">{props.title}</span>
        <span className="text-ink-muted">{` · ${props.source}`}</span>
      </p>
      {props.children}
    </li>
  );
}

// How far: "Finished" or "n of m sections", and a bar unless it has one section, as on
// Home (owner, 2026-10-26).
function Reached(props: { item: SavedItem | HistoryItem }) {
  const { finished, finishedSections, totalSections } = props.item;
  const done = finished ? totalSections : finishedSections;
  return (
    <>
      <p className={`text-sm ${finished ? "text-go-text" : "text-ink-muted"}`}>
        {finished
          ? "Finished"
          : `${String(finishedSections)} of ${String(totalSections)} sections`}
      </p>
      {totalSections <= 1 ? null : (
        <div aria-hidden="true" className="flex gap-1">
          {Array.from({ length: totalSections }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i < done ? "bg-go" : "bg-track"}`}
            />
          ))}
        </div>
      )}
    </>
  );
}

// A note goes back to its section on the publisher's page (§3.2), or to the article
// when it is on the whole article or its section was re-segmented away; named by the
// section, so notes on one article's sections read apart.
function NoteLink(props: { note: NoteEntry; chip: Chip }) {
  const { note, chip } = props;
  const label = note.momentId === null ? "Open article" : "Open section";
  return (
    <LibraryLink
      itemId={note.itemId}
      momentId={note.momentId ?? undefined}
      label={label}
      name={`${label}: ${note.sectionTitle ?? note.articleTitle}`}
      frameable={note.frameable}
      linkBroken={note.linkBroken}
      chip={chip}
    />
  );
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  // The reader opens and finishes in the user's usual break length; nothing here
  // counts toward a feed (owner, 2026-10-26).
  const chip = chosen.breakLength;
  // Back from a reader opened here: ask about what it showed (ADR-0018).
  const params = await searchParams;
  const ask = parseReading(
    typeof params["ask"] === "string" ? params["ask"] : undefined,
  );
  const [saved, finished, written, due] = await Promise.all([
    library().saves(actor.userId, LIMIT),
    library().history(actor.userId, LIMIT),
    notes().list(actor.userId, LIMIT),
    quizzes().dueReviews(actor.userId),
  ]);
  const minutes = Math.ceil((due.length * REVIEW_SECONDS_EACH) / 60);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-[52rem] lg:pt-10 lg:pl-64">
      <div className="flex items-center justify-between">
        <h1 className="text-display">Library</h1>
        <Link href="/profile" className="text-sm font-semibold text-ink-muted">
          Profile
        </Link>
      </div>
      <TabBar current="library" firstName={chosen.firstName} />

      {/* P2-W9-S05 (Q-P2-17, wireframe 08): the review queue is the top card. */}
      <section aria-label="Review queue">
        <h2 className="mb-3 text-section">Review queue</h2>
        <Card className="flex flex-col gap-3 p-5">
          {due.length === 0 ? (
            <p className="text-ink-muted">
              Nothing due for review. Concepts you test come back here when
              it&apos;s time to recall them.
            </p>
          ) : (
            <>
              <p className="font-semibold">
                {due.length === 1
                  ? "1 concept"
                  : `${String(due.length)} concepts`}{" "}
                due · about {minutes} min
              </p>
              <ul className="flex flex-wrap gap-2">
                {due.map((concept) => (
                  <li
                    key={concept.conceptId}
                    className="rounded-full bg-well px-3 py-1 text-sm"
                  >
                    {concept.name}
                  </li>
                ))}
              </ul>
              <form action={startReviewAction}>
                <input type="hidden" name="chip" value={chip} />
                <Button type="submit">Start review</Button>
              </form>
            </>
          )}
        </Card>
      </section>

      <section aria-label="Everything you kept">
        <h2 className="mb-3 text-section">Everything you kept</h2>
        <div className="grid grid-cols-2 gap-3">
          <div role="group" aria-label="Saved" className={TILE}>
            {icon(<path d="M6 3h12v18l-6-4-6 4z" />)}
            <span className="font-semibold">Saved</span>
            {/* Only the newest LIMIT are read, so a full page is "at least". */}
            <span className="text-numbers">
              {saved.length === LIMIT ? `${String(LIMIT)}+` : saved.length}
            </span>
          </div>
          <div role="group" aria-label="Notes" className={TILE}>
            {icon(<path d="M6 3h9l4 4v14H6zM9 12h7M9 16h5" />)}
            <span className="font-semibold">Notes</span>
            <span className="text-numbers">
              {written.length === LIMIT ? `${String(LIMIT)}+` : written.length}
            </span>
          </div>
          {LATER.map((tile) => (
            <div
              key={tile.label}
              role="group"
              aria-label={tile.label}
              aria-disabled="true"
              className={`${TILE} opacity-50`}
            >
              {tile.icon}
              <span className="font-semibold">{tile.label}</span>
              <span className="text-sm text-ink-muted">Coming later</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Saved">
        <h2 className="mb-3 text-section">Saved</h2>
        <Card>
          {saved.length === 0 ? (
            <p className="px-5 py-4 text-ink-muted">Nothing saved yet.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {saved.map((item) => (
                <Row
                  key={item.itemId}
                  title={item.articleTitle}
                  source={item.sourceName}
                >
                  {item.finished || item.finishedSections > 0 ? (
                    <Reached item={item} />
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <ReadLink item={item} chip={chip} />
                    <form action={libraryUnsaveAction}>
                      <input type="hidden" name="itemId" value={item.itemId} />
                      <Button
                        type="submit"
                        variant="secondary"
                        className="px-4 py-1.5 text-sm"
                        aria-label={`Unsave ${item.articleTitle}`}
                      >
                        Unsave
                      </Button>
                    </form>
                  </div>
                </Row>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* P2-W7-S04 (§5I, Q-P2-01): your notes, newest edit first; each edited by its
        own id, so one whose section was re-segmented away is still yours to edit. */}
      <section aria-label="Notes">
        <h2 className="mb-3 text-section">Notes</h2>
        <Card>
          {written.length === 0 ? (
            <p className="px-5 py-4 text-ink-muted">
              No notes yet. Add one from the note icon while you read.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {written.map((note) => (
                <Row
                  key={note.noteId}
                  title={note.articleTitle}
                  source={note.sourceName}
                  className="relative pr-16"
                >
                  <p className="text-sm text-ink-muted">
                    {note.sectionTitle ?? "Whole article"}
                  </p>
                  <p className="whitespace-pre-line">{note.body}</p>
                  <NoteLink note={note} chip={chip} />
                  <NoteBox
                    on={{ noteId: note.noteId }}
                    about={note.sectionTitle ?? note.articleTitle}
                    note={note.body}
                    back="/library"
                  />
                </Row>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* "History", not "Finished" (owner, 2026-10-26): it lists what you've read,
        part or whole. */}
      <section aria-label="History">
        <h2 className="mb-3 text-section">History</h2>
        <Card>
          {finished.length === 0 ? (
            <p className="px-5 py-4 text-ink-muted">Nothing here yet.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {finished.map((item) => (
                <Row
                  key={item.itemId}
                  title={item.articleTitle}
                  source={item.sourceName}
                >
                  <Reached item={item} />
                  <ReadLink item={item} chip={chip} />
                </Row>
              ))}
            </ul>
          )}
        </Card>
      </section>
      <ReturnPrompt chip={chip} initialAsk={ask} back="/library">
        {null}
      </ReturnPrompt>
    </main>
  );
}
