import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  library,
  listening,
  notes,
  preferences,
  sessionReader,
  quizzes,
} from "../../server/container";
import { outHref, readHref } from "../../server/outbound";
import type { HistoryItem, NoteEntry, SavedItem } from "../../server/ports";
import { parseReading } from "../../server/reading";
import { AudioQueue } from "../listen/AudioQueue";
import { stateLabel } from "../articleState";
import { NoteBox } from "../NoteBox";
import { ReturnPrompt } from "../ReturnPrompt";
import { TabBar } from "../TabBar";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { startReviewAction } from "../quiz/actions";
import { reviewMinutes } from "../reviewTime";
import { libraryUnsaveAction } from "./actions";

export const dynamic = "force-dynamic";

const LIMIT = 50;

// The Library tab (§4.1, §5I, C-06, Q-P1-19, P1-W5-S05): what you saved and what you
// read. Everything, hidden sources included: it is the reader's own record, not the
// feed.
// The link follows the article's state (ADR-0058): Open article when unread, Continue
// reading when opened, Read again when completed; always the article's own page. In
// Interval's reader when the page can be framed (ADR-0018), marked so Back asks; else
// the browser. Unless the weekly check found the page gone (P1-W6-S03): the item stays
// listed so the reader knows why it left the feed.
function ReadLink(props: { item: SavedItem | HistoryItem }) {
  const { item } = props;
  const label =
    item.state === "completed"
      ? "Read again"
      : item.state === "continue_reading"
        ? "Continue reading"
        : "Open article";
  return (
    <LibraryLink
      itemId={item.itemId}
      label={label}
      name={`${label}: ${item.articleTitle}`}
      frameable={item.frameable}
      linkBroken={item.linkBroken}
    />
  );
}

// A link out of the Library to the article on the publisher's page: the in-app reader
// when it can frame it, else the browser through /out.
function LibraryLink(props: {
  itemId: string;
  label: string;
  name: string;
  frameable: boolean;
  linkBroken: boolean;
}) {
  const { itemId, label, name } = props;
  if (props.linkBroken)
    return <p className="text-sm text-ink-muted">Link broken</p>;
  const className = "text-sm font-semibold text-select";
  return props.frameable ? (
    <a
      href={readHref({ itemId, from: "library" })}
      data-read-item={itemId}
      aria-label={name}
      className={className}
    >
      {label}
    </a>
  ) : (
    <a
      href={outHref({ itemId, from: "library", target: "original" })}
      data-item={itemId}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={name}
      className={className}
    >
      {label}
    </a>
  );
}

const icon = (path: ReactNode, className = "size-6") => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);

// Wide screens (web design, 2026-11): the shelf is a row of count pills beside its
// heading; the icons are for the phone's tiles.
const TILE =
  "flex flex-col gap-2 rounded-2xl bg-well p-4 lg:h-[38px] lg:flex-row lg:items-center lg:gap-[7px] lg:rounded-full lg:border-[1.5px] lg:border-hairline lg:bg-transparent lg:px-3.5 lg:py-0 lg:text-sm lg:[&>.text-numbers]:text-xs lg:[&>.text-numbers]:font-bold lg:[&>.text-numbers]:opacity-75";
const TILE_ICON = "size-6 lg:hidden";

// Highlights and audio come with later phases (owner, 2026-10-26): shown, dimmed, so the
// shelf has its final shape. Notes came in P2-W7-S04.
const LATER = [
  {
    label: "Highlights",
    icon: icon(<path d="M4 20h6M14 4l6 6-9 9H5v-6z" />, TILE_ICON),
  },
];

// The kinds of row, each with its mark on wide screens.
const MARKS = {
  saved: icon(<path d="M6 3h12v18l-6-4-6 4z" />, "size-[19px]"),
  note: icon(
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h4" />,
    "size-[19px]",
  ),
  read: icon(
    <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />,
    "size-[19px]",
  ),
};

// The lists drop their card on wide screens: hairline rows, as in the web design.
const LIST_CARD =
  "lg:rounded-none lg:border-x-0 lg:border-b-0 lg:bg-transparent lg:shadow-none";

function Row(props: {
  title: string;
  source: string;
  mark: keyof typeof MARKS;
  children: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={`flex flex-col gap-2 px-5 py-4 lg:min-h-16 lg:flex-row lg:items-start lg:gap-3.5 lg:px-1 lg:py-3 ${props.className ?? ""}`}
    >
      <span
        aria-hidden="true"
        className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-well text-ink-muted lg:flex"
      >
        {MARKS[props.mark]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 lg:gap-1.5">
        <p className="lg:flex lg:flex-col lg:gap-0.5">
          <span className="font-semibold lg:text-[15px] lg:leading-[1.35]">
            {props.title}
          </span>
          <span className="text-ink-muted lg:text-[13px]">
            <span className="lg:hidden"> · </span>
            {props.source}
          </span>
        </p>
        {props.children}
      </div>
    </li>
  );
}

// ADR-0058: a completed article says so; Continue reading is its link's own words.
function Completed(props: { item: SavedItem | HistoryItem }) {
  return props.item.state === "completed" ? (
    <p className="text-sm text-go-text">{stateLabel(props.item.state)}</p>
  ) : null;
}

// A note goes back to its article on the publisher's page (§3.2).
function NoteLink(props: { note: NoteEntry }) {
  const { note } = props;
  return (
    <LibraryLink
      itemId={note.itemId}
      label="Open article"
      name={`Open article: ${note.articleTitle}`}
      frameable={note.frameable}
      linkBroken={note.linkBroken}
    />
  );
}

// The review queue's picture band on wide screens (web design, 2026-11): two databases,
// a lagging copy and a clock, in the Review family. Decorative.
function ReviewArt() {
  const c = (role: string) => `var(--review-${role})`;
  return (
    <div
      aria-hidden="true"
      className="hidden h-24 items-center justify-center bg-(--review-tint) lg:flex"
    >
      <svg viewBox="0 0 300 84" className="h-[84px] w-[300px]">
        <path d="M96 22v34a22 7 0 0 0 44 0V22z" fill={c("left")} />
        <ellipse cx="118" cy="22" rx="22" ry="7" fill={c("top")} />
        <path
          d="M144 40h28"
          stroke={c("line")}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="2 7"
        />
        <path d="M178 30v30a18 6 0 0 0 36 0V30z" fill={c("left")} />
        <ellipse cx="196" cy="30" rx="18" ry="6" fill={c("top")} />
        <circle
          cx="222"
          cy="24"
          r="12"
          fill="var(--card)"
          stroke={c("line")}
          strokeWidth="2.5"
        />
        <path
          d="M222 18v6l4 3"
          fill="none"
          stroke={c("line")}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play; the rest is for accounts.
  if (actor.isGuest) redirect("/sign-up");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  // Back from a reader opened here: ask about what it showed (ADR-0018).
  const params = await searchParams;
  const askId = parseReading(
    typeof params["ask"] === "string" ? params["ask"] : undefined,
  );
  const ask = askId === null ? null : { itemId: askId };
  const [saved, read, written, due, listen] = await Promise.all([
    library().saves(actor.userId, LIMIT),
    library().history(actor.userId, LIMIT),
    notes().list(actor.userId, LIMIT),
    quizzes().dueReviews(actor.userId),
    listening().queue(actor.userId),
  ]);
  const minutes = reviewMinutes(due.length);
  return (
    // Wide screens (web design, 2026-11): a two-column grid beside the sidebar; the review
    // queue and the audio queue share the top row, the rest runs full width below.
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:mx-0 lg:grid lg:max-w-none lg:grid-cols-2 lg:items-start lg:gap-x-5 lg:gap-y-[22px] lg:pt-7 lg:pr-8 lg:pb-12 lg:pl-[14.5rem]">
      <div className="flex items-center justify-between lg:order-1 lg:col-span-2">
        <h1 className="text-display lg:text-[34px] lg:leading-[1.1] lg:tracking-[-0.03em]">
          Library
        </h1>
        <Link
          href="/profile"
          className="text-sm font-semibold text-ink-muted lg:hidden"
        >
          Profile
        </Link>
      </div>
      <TabBar current="library" firstName={chosen.firstName} />

      {/* P2-W9-S05 (Q-P2-17, wireframe 08): the review queue is the top card. */}
      <section
        id="review-queue"
        aria-label="Review queue"
        className="lg:relative lg:order-2 lg:pt-3.5"
      >
        <h2 className="mb-3 text-section lg:sr-only">Review queue</h2>
        {/* The web design's deck: the cards waiting behind this one. */}
        {due.length === 0 ? null : (
          <>
            <span
              aria-hidden="true"
              className="absolute inset-x-7 top-0 hidden h-10 rounded-[22px] bg-(--review-top) opacity-55 lg:block"
            />
            <span
              aria-hidden="true"
              className="absolute inset-x-3.5 top-[7px] hidden h-10 rounded-[22px] bg-(--review-left) opacity-55 lg:block"
            />
          </>
        )}
        <Card className="flex flex-col gap-3 p-5 lg:relative lg:gap-3 lg:overflow-hidden lg:p-0">
          <ReviewArt />
          {due.length === 0 ? (
            <p className="text-ink-muted lg:px-[22px] lg:pb-5">
              Nothing due for review. Concepts you test come back here when
              it&apos;s time to recall them.
            </p>
          ) : (
            <div className="flex flex-col gap-3 lg:px-[22px] lg:pb-5">
              <p className="font-semibold lg:text-[22px] lg:leading-tight lg:font-bold lg:tracking-[-0.015em]">
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
                <Button type="submit" className="lg:h-[50px] lg:w-full">
                  Start review
                </Button>
              </form>
            </div>
          )}
        </Card>
      </section>

      <section
        aria-label="Everything you kept"
        className="lg:order-4 lg:col-span-2 lg:flex lg:items-center lg:justify-between lg:gap-3"
      >
        <h2 className="mb-3 text-section lg:mb-0">Everything you kept</h2>
        <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:gap-1.5">
          <div role="group" aria-label="Saved" className={TILE}>
            {icon(<path d="M6 3h12v18l-6-4-6 4z" />, TILE_ICON)}
            <span className="font-semibold">Saved</span>
            {/* Only the newest LIMIT are read, so a full page is "at least". */}
            <span className="text-numbers">
              {saved.length === LIMIT ? `${String(LIMIT)}+` : saved.length}
            </span>
          </div>
          <div role="group" aria-label="Notes" className={TILE}>
            {icon(<path d="M6 3h9l4 4v14H6zM9 12h7M9 16h5" />, TILE_ICON)}
            <span className="font-semibold">Notes</span>
            <span className="text-numbers">
              {written.length === LIMIT ? `${String(LIMIT)}+` : written.length}
            </span>
          </div>
          <a href="#audio-queue" aria-label="Audio" className={TILE}>
            {icon(
              <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3z" />,
              TILE_ICON,
            )}
            <span className="font-semibold">Audio</span>
            <span className="text-numbers">{listen.queue.length}</span>
          </a>
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
              <span className="text-sm text-ink-muted lg:text-xs">
                Coming later
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* P4-W23-S01 (§5I): the audio queue, played by the global player. */}
      <section
        id="audio-queue"
        aria-label="Audio queue"
        className="lg:order-3 lg:pt-3.5"
      >
        <h2 className="mb-3 text-section lg:text-[17px]">Audio queue</h2>
        <Card>
          <AudioQueue initial={listen.queue} />
        </Card>
      </section>

      <section aria-label="Saved" className="lg:order-5 lg:col-span-2">
        <h2 className="mb-3 text-section lg:text-[17px]">Saved</h2>
        <Card className={LIST_CARD}>
          {saved.length === 0 ? (
            <p className="px-5 py-4 text-ink-muted">Nothing saved yet.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {saved.map((item) => (
                <Row
                  key={item.itemId}
                  title={item.articleTitle}
                  source={item.sourceName}
                  mark="saved"
                >
                  <Completed item={item} />
                  <div className="flex items-center justify-between gap-3">
                    <ReadLink item={item} />
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
        own id, so a note written on a section before ADR-0058 is still yours to edit. */}
      <section className="lg:order-6 lg:col-span-2" aria-label="Notes">
        <h2 className="mb-3 text-section lg:text-[17px]">Notes</h2>
        <Card className={LIST_CARD}>
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
                  mark="note"
                  className="relative pr-16"
                >
                  <p className="whitespace-pre-line">{note.body}</p>
                  <NoteLink note={note} />
                  <NoteBox
                    on={{ noteId: note.noteId }}
                    about={note.articleTitle}
                    note={note.body}
                    back="/library"
                  />
                </Row>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* "History", not "Finished" (owner, 2026-10-26): it lists what you've opened
        or completed (ADR-0058). */}
      <section aria-label="History" className="lg:order-7 lg:col-span-2">
        <h2 className="mb-3 text-section lg:text-[17px]">History</h2>
        <Card className={LIST_CARD}>
          {read.length === 0 ? (
            <p className="px-5 py-4 text-ink-muted">Nothing here yet.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {read.map((item) => (
                <Row
                  key={item.itemId}
                  title={item.articleTitle}
                  source={item.sourceName}
                  mark="read"
                >
                  <Completed item={item} />
                  <ReadLink item={item} />
                </Row>
              ))}
            </ul>
          )}
        </Card>
      </section>
      <ReturnPrompt initialAsk={ask} back="/library">
        {null}
      </ReturnPrompt>
    </main>
  );
}
