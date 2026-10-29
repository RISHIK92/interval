import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { CHIPS } from "../../../server/chips";
import {
  notes,
  outboundLinks,
  quizzes,
  sessionReader,
} from "../../../server/container";
import { attributed, countOpen } from "../../../server/opens";
import { outHref, readHref } from "../../../server/outbound";
import { BIGINT_ID, quizKey, type ReaderPage } from "../../../server/ports";
import { formatReading } from "../../../server/reading";
import { visitId } from "../../../server/visits";
import { feedbackAction } from "../../feedback/actions";
import { finishAction } from "../../finish/actions";
import { NoteBox } from "../../NoteBox";
import { StartQuiz, ZAP } from "../../quiz/StartQuiz";
import { ReaderFrame } from "./ReaderFrame";

export const dynamic = "force-dynamic";

// As /out's query, with the chip always there: the reader goes back to that feed. A
// feed card has a position; "continue" is a Continue card, "reader" a move inside the
// reader (back after Save), which counts no event, and "library" an open from the
// Library, which counts none either and goes back there (owner, 2026-10-26). "path"
// is a path's reading (P2-W10-S03): it names its path, counts nothing, and goes back
// to the path.
const Read = z.object({
  moment: z.string().regex(BIGINT_ID).optional(),
  chip: z.enum(CHIPS),
  pos: z.coerce.number().int().min(1).max(200).optional(),
  from: z.enum(["continue", "reader", "library", "path"]).optional(),
  path: z.string().regex(BIGINT_ID).optional(),
});

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
  const { item } = await params;
  const parsed = Read.safeParse(await searchParams);
  if (!BIGINT_ID.test(item) || !parsed.success) redirect("/");
  const { moment, chip, pos, from, path } = parsed.data;
  if ((from === undefined) === (pos === undefined)) redirect("/");
  // A path's reading names its path; nothing else does.
  if ((from === "path") !== (path !== undefined)) redirect("/");
  const card = pos === undefined ? null : { chip, pos };
  const origin = card === null ? (from ?? "continue") : { position: card.pos };
  const browserHref = outHref({
    itemId: item,
    ...(moment === undefined ? {} : { momentId: moment }),
    target: "section",
    ...(typeof origin === "string" ? { from: origin } : { chip, from: origin }),
  });
  // Where Next section keeps going from: a path's reading stays one.
  const nextFrom =
    path !== undefined
      ? { path }
      : // "path" always comes with its path (checked above).
        (origin as Exclude<typeof origin, "path">);
  // Leaving for the browser from inside the reader: the open is already counted, so
  // only the outbound click is recorded (from=reader).
  const leaveHref = outHref({
    itemId: item,
    ...(moment === undefined ? {} : { momentId: moment }),
    target: "section",
    from: "reader",
  });
  const page = await outboundLinks().reader(actor.userId, item, moment ?? null);
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
    {
      itemId: item,
      momentId: moment,
      link: page.link,
      card,
      from,
      surface: "in_app",
    },
  );
  // The section really reached; a link that fell back is the article (as /out says).
  const reached = page.link.linkType === "article" ? null : (moment ?? null);
  const title =
    page.sectionTitle === null || page.sectionTitle === page.articleTitle
      ? page.articleTitle
      : `${page.sectionTitle} — ${page.articleTitle}`;
  const domain = new URL(publisher).hostname.replace(/^www\./, "");
  // Back to where it was opened, asking "Finished?" about what was shown (C-22's
  // prompt): the feed, the Library, or the path.
  const library = from === "library";
  const back =
    path !== undefined ? `/paths/${path}` : library ? "/library" : null;
  const asked = formatReading({ itemId: item, momentId: reached });
  const closeHref =
    back === null ? `/?chip=${chip}&ask=${asked}` : `${back}?ask=${asked}`;
  const note = await notes().get(actor.userId, item, reached);
  // Test 60s on what's shown (P2-W9-S02), once it has a live question.
  const testable = (
    await quizzes().offered([{ itemId: item, momentId: reached }])
  ).has(quizKey(item, reached));
  const here = readHref({
    itemId: item,
    ...(moment === undefined ? {} : { momentId: moment }),
    chip,
    from: path !== undefined ? { path } : library ? "library" : "reader",
  });
  return (
    <main className="flex h-dvh flex-col">
      <h1 className="sr-only">{title}</h1>
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2">
        <a href={closeHref} aria-label="Close reader" className={ROUND}>
          <Glyph path="M6 6l12 12M18 6L6 18" />
        </a>
        <p className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-well px-3 py-1.5 text-sm text-ink-muted">
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
          aria-label="Open in browser"
          title="Open in browser"
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
      <footer className="relative flex shrink-0 flex-col gap-3 border-t border-hairline bg-page px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {/* Room for the note icon at the footer's top right, Why or not. */}
        <div className="min-h-9 pr-12">
          <Why reasons={page.reasons} />
        </div>
        <NoteBox
          on={{ itemId: item, momentId: reached }}
          about={title}
          note={note}
          back={here}
        />
        <div className="flex items-center gap-2">
          <form action={feedbackAction}>
            <input type="hidden" name="itemId" value={item} />
            <input type="hidden" name="chip" value={chip} />
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
          <ComingLater name="Listen">
            <Glyph path="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3z" />
          </ComingLater>
          {testable ? (
            <StartQuiz
              itemId={item}
              momentId={reached}
              chip={chip}
              back={here}
              label="Test me"
              className={ROUND}
            >
              <Glyph path={ZAP} />
            </StartQuiz>
          ) : (
            <ComingLater name="Test me" why="No questions yet">
              <Glyph path={ZAP} />
            </ComingLater>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* Mark done goes back where the reader was opened and skips the prompt
              (ADR-0018). */}
            <form action={finishAction}>
              <input type="hidden" name="control" value="finish" />
              <input type="hidden" name="itemId" value={item} />
              {reached === null ? null : (
                <input type="hidden" name="momentId" value={reached} />
              )}
              <input type="hidden" name="method" value="mark_done" />
              <input type="hidden" name="chip" value={chip} />
              {back !== null ? (
                <input type="hidden" name="back" value={back} />
              ) : null}
              <button
                type="submit"
                className="inline-flex size-11 items-center justify-center rounded-full border border-hairline bg-page font-semibold text-ink sm:size-auto sm:px-4 sm:py-2.5"
              >
                <Glyph path="M5 12l5 5 9-10" className="size-5 sm:hidden" />
                <span className="sr-only sm:not-sr-only">Mark done</span>
              </button>
            </form>
            {page.nextMomentId === null ? null : (
              <a
                href={readHref({
                  itemId: item,
                  momentId: page.nextMomentId,
                  chip,
                  // An open of the next section from the same card, counted like one
                  // (owner, 2026-10-26); after Save the card is unknown, so none.
                  from: nextFrom,
                })}
                className="inline-flex size-11 items-center justify-center rounded-full bg-ink font-semibold text-page sm:size-auto sm:px-4 sm:py-2.5"
              >
                <Glyph
                  path="M5 12h14M13 6l6 6-6 6"
                  className="size-5 sm:hidden"
                />
                <span className="sr-only sm:not-sr-only">Next section</span>
              </a>
            )}
          </div>
        </div>
      </footer>
    </main>
  );
}

// Mark done and Next section are icons only on phones (owner, 2026-10-26), at their
// own size.
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

// Shown, not usable yet (owner, ADR-0018): highlight and listen come later; Test me
// waits for its section's questions.
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

// ADR-0026: why the ranking showed it, one line until opened.
function Why({ reasons }: { reasons: ReaderPage["reasons"] }) {
  if (reasons === null) return null;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-hairline px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate text-ink-muted group-open:hidden">
          {reasons}
        </span>
        <span className="hidden group-open:inline">Why it&apos;s here</span>
      </summary>
      <p className="mt-2 max-h-40 overflow-y-auto text-sm">{reasons}</p>
    </details>
  );
}
