import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { CHIPS } from "../../../server/chips";
import { outboundLinks, sessionReader } from "../../../server/container";
import { attributed, countOpen } from "../../../server/opens";
import { outHref, readHref } from "../../../server/outbound";
import { BIGINT_ID, type ReaderPage } from "../../../server/ports";
import { formatReading } from "../../../server/reading";
import { visitId } from "../../../server/visits";
import { feedbackAction } from "../../feedback/actions";
import { finishAction } from "../../finish/actions";
import { WhyNote } from "../../WhyNote";
import { ReaderFrame } from "./ReaderFrame";

export const dynamic = "force-dynamic";

// As /out's query, with the chip always there: the reader goes back to that feed. A
// feed card has a position; "continue" is a Continue card, "reader" a move inside the
// reader (Next section, or back after Save), which counts no event.
const Read = z.object({
  moment: z.string().regex(BIGINT_ID).optional(),
  chip: z.enum(CHIPS),
  pos: z.coerce.number().int().min(1).max(200).optional(),
  from: z.enum(["continue", "reader"]).optional(),
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
  const { moment, chip, pos, from } = parsed.data;
  if ((from === undefined) === (pos === undefined)) redirect("/");
  const card = pos === undefined ? null : { chip, pos };
  const browserHref = outHref({
    itemId: item,
    ...(moment === undefined ? {} : { momentId: moment }),
    target: "section",
    ...(card === null
      ? { from: from ?? "continue" }
      : { chip, from: { position: card.pos } }),
  });
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
  // Back to the feed asking "Finished?" about what was shown (C-22's prompt).
  const closeHref = `/?chip=${chip}&ask=${formatReading({ itemId: item, momentId: reached })}`;
  const here = readHref({
    itemId: item,
    ...(moment === undefined ? {} : { momentId: moment }),
    chip,
    from: "reader",
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
      <footer className="flex shrink-0 flex-col gap-3 border-t border-hairline bg-page px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Why note={page.note} />
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
          <ComingLater name="Test me">
            <Glyph path="M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 18.5v.5" />
          </ComingLater>
          <div className="ml-auto flex items-center gap-2">
            {/* Mark done goes to the feed and skips the prompt (ADR-0018). */}
            <form action={finishAction}>
              <input type="hidden" name="control" value="finish" />
              <input type="hidden" name="itemId" value={item} />
              {reached === null ? null : (
                <input type="hidden" name="momentId" value={reached} />
              )}
              <input type="hidden" name="method" value="mark_done" />
              <input type="hidden" name="chip" value={chip} />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-full border border-hairline bg-page px-4 py-2.5 font-semibold text-ink"
              >
                Mark done
              </button>
            </form>
            {page.nextMomentId === null ? null : (
              <a
                href={readHref({
                  itemId: item,
                  momentId: page.nextMomentId,
                  chip,
                  from: "reader",
                })}
                className="inline-flex items-center justify-center rounded-full bg-ink px-4 py-2.5 font-semibold text-page"
              >
                Next section
              </a>
            )}
          </div>
        </div>
      </footer>
    </main>
  );
}

function Glyph({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4"
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

// Shown, not usable yet (owner, ADR-0018): highlight, listen and quiz come later.
function ComingLater({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-disabled="true"
      title="Coming later"
      className={`${ROUND} cursor-not-allowed opacity-50`}
    >
      {children}
      <span className="sr-only">{`${name}. Coming later`}</span>
    </button>
  );
}

// Why this matters (§5E), one line until opened; AI only once a model wrote it (AI-1).
function Why({ note }: { note: ReaderPage["note"] }) {
  if (note === null) return null;
  return (
    <details className="group">
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 rounded-full border ${note.ai ? "border-dashed " : ""}border-hairline px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden`}
      >
        Why this matters
        <span className="min-w-0 flex-1 truncate text-ink-muted group-open:hidden">
          {note.text}
        </span>
        {note.ai ? (
          <span className="rounded-md bg-well px-1.5 py-0.5 text-xs font-semibold text-ink-muted">
            AI
          </span>
        ) : null}
      </summary>
      <div className="mt-2 max-h-40 overflow-y-auto text-sm">
        <WhyNote note={note} />
      </div>
    </details>
  );
}
