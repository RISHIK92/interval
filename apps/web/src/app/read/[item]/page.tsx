import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import {
  listening,
  notes,
  outboundLinks,
  quizzes,
  sessionReader,
} from "../../../server/container";
import { attributed, countOpen } from "../../../server/opens";
import { outHref, readHref } from "../../../server/outbound";
import { BIGINT_ID } from "../../../server/ports";
import { visitId } from "../../../server/visits";
import { feedbackAction } from "../../feedback/actions";
import { finishAction } from "../../finish/actions";
import { ListenButton } from "../../listen/ListenButton";
import { NoteBox } from "../../NoteBox";
import { StartQuiz, ZAP } from "../../quiz/StartQuiz";
import { ReaderFrame } from "./ReaderFrame";

export const dynamic = "force-dynamic";

// As /out's query. A feed card has a position; "continue" is a Continue card, "reader"
// a move inside the reader (back after Save), which counts no event, and "library" an
// open from the Library, which counts none either and goes back there (owner,
// 2026-10-26). "path" is a path's reading (P2-W10-S03): it names its path, counts
// nothing, and goes back to the path. ADR-0058: a section or chip an older link names
// is ignored (zod drops unknown keys).
const Read = z.object({
  pos: z.coerce.number().int().min(1).max(200).optional(),
  from: z.enum(["continue", "reader", "library", "path"]).optional(),
  path: z.string().regex(BIGINT_ID).optional(),
  // P7-W46: a card a companion surface suggested, as /out's.
  via: z.literal("agent").optional(),
});

const LISTEN = "M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3z";

// Smaller than the feed's round buttons: the reader's bars stay out of the page's way
// (owner, 2026-10-26).
const ROUND =
  "flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-page text-ink";

// ADR-0018: Interval's in-app reader. The publisher's live page in a frame (a deep
// link, never a copy: §3.2, ING-2), Interval's header above it and the overlay below.
// A page that can't be framed opens in the browser through /out, as before.
export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ item: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play; the rest is for accounts.
  if (actor.isGuest) redirect("/sign-up");
  const { item } = await params;
  const parsed = Read.safeParse(await searchParams);
  if (!BIGINT_ID.test(item) || !parsed.success) redirect("/");
  const { pos, from, path, via } = parsed.data;
  if ((from === undefined) === (pos === undefined)) redirect("/");
  // A path's reading names its path; nothing else does.
  if ((from === "path") !== (path !== undefined)) redirect("/");
  const card =
    pos === undefined ? null : { pos, via: via ?? ("feed" as const) };
  const browserHref = outHref({
    itemId: item,
    target: "article",
    from:
      card === null
        ? (from ?? "continue")
        : { position: card.pos, ...(via === undefined ? {} : { via }) },
  });
  // Leaving for the browser from inside the reader: the open is already counted, so
  // only the outbound click is recorded (from=reader). ADR-0058: the article's own
  // canonical page.
  const leaveHref = outHref({
    itemId: item,
    target: "original",
    from: "reader",
  });
  const page = await outboundLinks().reader(actor.userId, item);
  const publisher = page === null ? null : attributed(page.link.url);
  // The frame takes https only (frame-src https:); /out handles what's left, a stale
  // card and an unknown item included.
  if (
    page === null ||
    !page.frameable ||
    publisher === null ||
    !publisher.startsWith("https:")
  ) {
    redirect(browserHref);
  }
  await countOpen(
    { ...actor, sessionId: visitId(await cookies()) },
    { itemId: item, card, from, surface: "in_app" },
  );
  const title = page.articleTitle;
  const domain = new URL(publisher).hostname.replace(/^www\./, "");
  // Back to where it was opened, asking "Finished?" about it (C-22's prompt): the
  // feed, the Library, or the path.
  const library = from === "library";
  const back =
    path !== undefined ? `/paths/${path}` : library ? "/library" : null;
  const closeHref = `${back ?? "/"}?ask=${item}`;
  const allNotes = await notes().onItems(actor.userId, [item]);
  const note = allNotes[0]?.body ?? null;
  // ADR-0058: Quiz me, the article's one quiz, once it has a live question; it stays
  // after the article is completed.
  const testable = (await quizzes().offered([item])).has(item);
  // P4-W23-S01: Listen, once a concept here has a voiced explainer.
  const voiced = (await listening().voiced(item)).length > 0;
  const here = readHref({
    itemId: item,
    from: path !== undefined ? { path } : library ? "library" : "reader",
  });
  return (
    <main className="flex h-dvh flex-col">
      <h1 className="sr-only">{title}</h1>
      {/* Wide screens: the web design's full-screen bar (Book reader, web), the
        page's address centred in it. */}
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2 lg:gap-4 lg:px-6 lg:py-3">
        <a href={closeHref} aria-label="Close reader" className={ROUND}>
          <Glyph path="M6 6l12 12M18 6L6 18" />
        </a>
        <p className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-well px-3 py-1.5 text-sm text-ink-muted lg:mx-auto lg:max-w-[28rem] lg:py-2">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <span className="truncate">{domain}</span>
        </p>
        {/* An arrow only (owner, 2026-10-26); its name says where it goes. */}
        <a
          href={leaveHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open original in browser"
          title="Open original in browser"
          className={ROUND}
        >
          <Glyph path="M7 17L17 7M9 7h8v8" />
        </a>
      </header>
      <ReaderFrame
        key={publisher}
        src={publisher}
        title={title}
        domain={domain}
        browserHref={leaveHref}
      />
      {/* One compact row (owner, 2026-10-30, ADR-0028): the card's why stays on the
        card. The note's icon sits in the row's slot after Quiz me; its text area opens
        below the row. */}
      <footer className="relative flex shrink-0 flex-col gap-2 border-t border-hairline bg-page px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <div className="flex h-11 items-center gap-2">
          <form action={feedbackAction}>
            <input type="hidden" name="itemId" value={item} />
            <input type="hidden" name="back" value={here} />
            <button
              type="submit"
              name="control"
              value={page.saved ? "unsave" : "save"}
              aria-label={
                page.saved ? `Saved: unsave ${title}` : `Save ${title}`
              }
              className={ROUND}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-5"
                fill={page.saved ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              >
                <path d="M6 3h12v18l-6-4-6 4z" />
              </svg>
            </button>
          </form>
          <ComingLater name="Highlight">
            <Glyph path="M4 20h6M14 4l6 6-9 9H5v-6z" />
          </ComingLater>
          {voiced ? (
            <ListenButton itemId={item} className={ROUND}>
              <Glyph path={LISTEN} />
            </ListenButton>
          ) : (
            <ComingLater name="Listen" why="No AI explainer here yet">
              <Glyph path={LISTEN} />
            </ComingLater>
          )}
          {testable ? (
            <StartQuiz
              itemId={item}
              back={here}
              label="Quiz me"
              className={ROUND}
            >
              <Glyph path={ZAP} />
            </StartQuiz>
          ) : (
            <ComingLater name="Quiz me" why="No questions yet">
              <Glyph path={ZAP} />
            </ComingLater>
          )}
          {/* The note's slot. */}
          <span aria-hidden="true" className="size-9 shrink-0" />
          <div className="ml-auto flex items-center gap-2">
            {page.state === "completed" ? (
              // ADR-0058: Completed replaces Done; Quiz me stays in the row.
              <p className="inline-flex h-11 items-center gap-1.5 px-2 font-semibold text-ink-muted">
                <Glyph path="M5 12l5 5 9-10" className="size-5" />
                Completed
              </p>
            ) : (
              // Done completes the article, goes back where the reader was opened and
              // skips the prompt (ADR-0018, ADR-0058).
              <form action={finishAction}>
                <input type="hidden" name="control" value="finish" />
                <input type="hidden" name="itemId" value={item} />
                <input type="hidden" name="method" value="mark_done" />
                {back !== null ? (
                  <input type="hidden" name="back" value={back} />
                ) : null}
                <button
                  type="submit"
                  className="inline-flex size-11 items-center justify-center rounded-full bg-ink font-semibold text-page sm:size-auto sm:px-4 sm:py-2.5 lg:px-5 lg:text-[15px]"
                >
                  <Glyph path="M5 12l5 5 9-10" className="size-5 sm:hidden" />
                  <span className="sr-only sm:not-sr-only">Done</span>
                </button>
              </form>
            )}
          </div>
        </div>
        <NoteBox
          on={{ itemId: item }}
          about={title}
          note={note}
          back={here}
          // Below the footer's pt-2, centred in the h-11 row; four 9-wide buttons
          // and their gaps after px-4.
          at="top-3 left-48"
        />
      </footer>
    </main>
  );
}

// Done is an icon only on phones (owner, 2026-10-26), at its own size.
function Glyph({
  path,
  className = "size-4",
}: {
  path: string;
  className?: string;
}) {
  return (
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
      <path d={path} />
    </svg>
  );
}

// Shown, not usable yet (owner, ADR-0018): highlight comes later, Listen waits for a
// voiced explainer (P4-W23-S01); Quiz me waits for the article's questions.
function ComingLater({
  name,
  why = "Coming later",
  children,
}: {
  name: string;
  why?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-disabled="true"
      title={why}
      className={`${ROUND} cursor-not-allowed opacity-50`}
    >
      {children}
      <span className="sr-only">{`${name}. ${why}`}</span>
    </button>
  );
}
