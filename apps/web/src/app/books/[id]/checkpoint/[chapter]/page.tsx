import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  books,
  preferences,
  sessionReader,
} from "../../../../../server/container";
import {
  BIGINT_ID,
  type ChapterEnd,
  passMark,
} from "../../../../../server/ports";
import { TabBar } from "../../../../TabBar";
import { startBookCheckpointAction } from "../../../../quiz/actions";
import { Card } from "../../../../ui/Card";
import { requestCheckpointAction } from "../../../actions";

export const dynamic = "force-dynamic";

const BUTTON =
  "inline-flex cursor-pointer items-center justify-center self-start rounded-full bg-ink px-5 py-2.5 font-semibold text-page";
const SECONDARY =
  "inline-flex cursor-pointer items-center justify-center self-start rounded-full border border-hairline px-5 py-2.5 font-semibold";

// §5F, Q-P2-35 (P2-W11-S06): a chapter's end. Its checkpoint is made from the chapter
// when the user gets here, so this says how that's going, then offers it: 60 seconds,
// pass 4 of 5 (Q-P2-26). The chapters don't lock (owner, 2026-10-29): the next
// session is always one tap away.
export default async function ChapterEndPage(props: {
  params: Promise<{ id: string; chapter: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play; the rest is for accounts.
  if (actor.isGuest) redirect("/sign-up");
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const { id, chapter } = await props.params;
  if (!BIGINT_ID.test(id) || !BIGINT_ID.test(chapter)) notFound();
  const end = await books().checkpoint(actor.userId, chapter);
  if (end?.bookId !== id) notFound();
  const here = `/books/${id}/checkpoint/${chapter}`;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-[46rem] lg:pt-10 lg:pl-64">
      <TabBar current="paths" firstName={chosen.firstName} />
      <header className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">
          <Link href="/paths#your-books" className="font-semibold text-select">
            {end.bookTitle}
          </Link>{" "}
          · End of chapter
        </p>
        <h1 className="text-display">{end.title}</h1>
      </header>
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-title">Chapter checkpoint</h2>
        <Checkpoint end={end} chip={chosen.breakLength} here={here} />
      </Card>
      <footer className="flex flex-col gap-2 border-t border-hairline pt-6">
        {end.next === null ? (
          <Link href="/paths#your-books" className="font-semibold text-select">
            Back to your books
          </Link>
        ) : (
          <p>
            <span className="text-ink-muted">Next: </span>
            <Link
              href={`/books/${id}?session=${end.next.sessionId}`}
              className="font-semibold text-select"
            >
              {end.next.title}
            </Link>
          </p>
        )}
      </footer>
    </main>
  );
}

function Checkpoint({
  end,
  chip,
  here,
}: {
  end: ChapterEnd;
  chip: string;
  here: string;
}) {
  const ask = (label: string) => (
    <form action={requestCheckpointAction}>
      <input type="hidden" name="bookId" value={end.bookId} />
      <input type="hidden" name="chapterId" value={end.chapterId} />
      <button type="submit" className={BUTTON}>
        {label}
      </button>
    </form>
  );
  if (end.state === "none")
    return end.finished ? (
      <>
        <p className="text-ink-muted">
          Five questions on this chapter, made from its text.
        </p>
        {ask("Make the checkpoint")}
      </>
    ) : (
      <p className="text-ink-muted">
        Finish this chapter&apos;s sessions to take its checkpoint.
      </p>
    );
  if (end.state === "preparing")
    return end.stuck ? (
      <>
        <p role="status">This is taking longer than it should.</p>
        {ask("Try again")}
      </>
    ) : (
      <>
        {/* Checked again every few seconds until it's made; React puts this in the
          head. */}
        <meta httpEquiv="refresh" content="3" />
        <p role="status" className="text-ink-muted">
          Preparing your checkpoint…
        </p>
      </>
    );
  if (end.state === "failed")
    return (
      <>
        <p role="alert">{end.failure}</p>
        {ask("Try again")}
      </>
    );
  return (
    <>
      <p className="text-ink-muted">
        60 seconds · {end.size} questions · pass {passMark(end.size)} of{" "}
        {end.size}
      </p>
      {end.concepts.length === 0 ? null : (
        <p className="text-sm text-ink-muted">On {end.concepts.join(", ")}</p>
      )}
      {end.last === null ? null : (
        <p role="status" className="font-semibold">
          {end.last.passed
            ? `Passed ${String(end.last.correct)} of ${String(end.last.size)}`
            : `Not yet: ${String(end.last.correct)} of ${String(end.last.size)}`}
        </p>
      )}
      <form action={startBookCheckpointAction}>
        <input type="hidden" name="chapterId" value={end.chapterId} />
        <input type="hidden" name="chip" value={chip} />
        <input type="hidden" name="back" value={here} />
        <button
          type="submit"
          className={end.last?.passed === true ? SECONDARY : BUTTON}
        >
          {end.last === null ? "Take the checkpoint" : "Take it again"}
        </button>
      </form>
    </>
  );
}
