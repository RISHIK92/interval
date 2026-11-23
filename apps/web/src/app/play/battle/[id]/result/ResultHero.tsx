import Link from "next/link";

// Battle results' wide-screen head (Battle results, web), for LLD and HLD alike: a bar
// back to Play with the problem, then the outcome beside the podium drawing, with the
// viewer's rating change. Phones keep each page's own heading.

// A total is null until the match is scored (HLD), and so is the outcome.
type Player = { place: number | null; total: number | null; name: string };

const ORDINAL = ["1st", "2nd", "3rd"];

// "You won, 82 to 77" in a 1v1; "You placed 2nd of 4" in a room.
export function outcome(me: Player | undefined, others: Player[]): string {
  if (me === undefined || me.place === null || me.total === null)
    return "Results";
  const [other] = others;
  if (other === undefined) return `You scored ${String(me.total)}`;
  const score =
    others.length === 1 && other.total !== null
      ? `, ${String(me.total)} to ${String(other.total)}`
      : "";
  if (me.place === 1)
    return others.some((o) => o.place === 1)
      ? `A tie for first${score}`
      : `You won${score}`;
  if (others.length === 1) return `You lost${score}`;
  return `You placed ${ORDINAL[me.place - 1] ?? `${String(me.place)}th`} of ${String(others.length + 1)}`;
}

export function ResultHero({
  kind,
  problem,
  headline,
  detail,
  change,
}: {
  kind: string;
  problem: string;
  headline: string;
  detail: string;
  change: number | null;
}) {
  return (
    <div className="hidden lg:contents">
      <header className="-mx-7 flex items-center gap-3.5 border-b border-hairline px-6 pb-3">
        <Link
          href="/play"
          aria-label="Back to Play"
          className="flex size-10 items-center justify-center rounded-full border-[1.5px] border-hairline"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-[18px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <p className="text-[13px] font-medium text-ink-muted">
            {kind} · results
          </p>
          <p className="text-section tracking-[-0.01em]">{problem}</p>
        </div>
      </header>
      <section
        aria-label="Outcome"
        className="flex overflow-hidden rounded-3xl border border-hairline bg-page shadow-card"
      >
        <div className="flex min-h-32 w-60 shrink-0 items-center justify-center bg-(--system-design-tint)">
          <svg aria-hidden="true" viewBox="0 0 240 120" className="w-60">
            <path
              d="M64 52 94 67 64 82 34 67z"
              fill="var(--system-design-top)"
            />
            <path d="M34 67 64 82v30L34 97z" fill="var(--system-design-left)" />
            <path
              d="M64 82 94 67v30L64 112z"
              fill="var(--system-design-right)"
            />
            <path
              d="M176 60 206 75 176 90 146 75z"
              fill="var(--system-design-top)"
            />
            <path
              d="M146 75 176 90v22L146 97z"
              fill="var(--system-design-left)"
            />
            <path
              d="M176 90 206 75v22L176 112z"
              fill="var(--system-design-right)"
            />
            <path
              d="M120 22 150 37 120 52 90 37z"
              fill="var(--system-design-top)"
            />
            <path
              d="M90 37 120 52v60L90 97z"
              fill="var(--system-design-left)"
            />
            <path
              d="M120 52 150 37v60L120 112z"
              fill="var(--system-design-right)"
            />
            <path
              d="M120 37V5"
              fill="none"
              stroke="var(--system-design-line)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path d="M120 5 140 10.5 120 16z" fill="var(--go)" />
          </svg>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-5 px-[26px] py-[22px]">
          <div className="min-w-56 flex-1">
            <h1 className="text-[40px] leading-none font-bold tracking-[-0.03em] tabular-nums">
              {headline}
            </h1>
            <p className="mt-2 text-[15px] font-medium text-ink-muted">
              {detail}
            </p>
          </div>
          {change === null ? null : (
            <span
              className={`flex h-10 items-center gap-1.5 rounded-full px-4 text-lg font-bold tabular-nums ${change >= 0 ? "bg-go/15 text-go-text" : "bg-wrong/10 text-wrong"}`}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className={`size-4 ${change >= 0 ? "" : "rotate-180"}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
              {change >= 0 ? "+" : "−"}
              {Math.abs(change).toFixed(1)} rating
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
