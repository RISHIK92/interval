import type { Coverage } from "@interval/hld";
import Link from "next/link";

// The web design's battle frame ("HLD battle, web" and "LLD battle, web"): on a
// desktop, a bordered frame with a header row and three columns (the brief, the canvas
// or the code, the selection or the tests). The pages place their parts into it; on a
// phone it's the single column it was.

// Owner (2026-11-27): on a desktop the battle screens fill the window edge to edge (no
// margin, border or width cap); the middle column takes the extra width.
const FRAME_BASE =
  "mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-6 pb-12 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,19rem)] lg:gap-0 lg:overflow-hidden lg:p-0";

// The HLD canvas's frame fits the window, as the design does: the palette under the
// canvas and the submission at the foot of the right column stay in view, and each
// column scrolls on its own.
export const CANVAS_FRAME = `${FRAME_BASE} lg:h-dvh lg:min-h-[640px] lg:grid-rows-[auto_auto_minmax(0,1fr)]`;

// The same frame for watching a match or its replay: the header row, then the designs
// side by side.
export const VIEW_FRAME =
  "mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-6 pb-12 lg:min-h-dvh lg:max-w-none lg:gap-0 lg:overflow-hidden lg:p-0";

export const HEADER =
  "lg:col-span-3 lg:flex lg:flex-wrap lg:items-center lg:gap-3.5 lg:border-b lg:border-hairline lg:px-5 lg:py-3.5";

export const HEADER_TILE =
  "hidden size-11 shrink-0 items-center justify-center rounded-xl bg-(--system-design-tint) lg:flex";

export const TITLE =
  "text-display lg:text-[18px] lg:leading-snug lg:tracking-[-0.01em]";

// The header's way out, as the design's close button; phones have the page's own links.
export function CloseLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="hidden size-11 shrink-0 items-center justify-center rounded-xl border-[1.5px] text-ink lg:flex lg:border-hairline-strong"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </Link>
  );
}

// Q-WD-15: the problem's requirements as the design covers them. Covered: a green card
// naming what covers it; not yet: a dashed card saying so. ADR-0060: coverage is a
// verdict, so until a submit (`coverage` null) the requirements are only listed.
export function Requirements({
  requirements,
  coverage,
}: {
  requirements: readonly string[];
  coverage: Coverage | null;
}) {
  return (
    <section
      aria-labelledby="requirements-title"
      className="flex flex-col gap-1.5 lg:col-start-1 lg:row-start-2 lg:max-h-[45vh] lg:overflow-y-auto lg:border-r lg:border-hairline lg:p-5 lg:pb-0"
    >
      <h2
        id="requirements-title"
        className="mb-1 flex items-baseline justify-between gap-2"
      >
        <span className="text-[15px] font-semibold">Requirements</span>
        {coverage === null ? null : (
          <span
            aria-live="polite"
            className="text-[13px] font-normal text-ink-muted tabular-nums"
          >
            {coverage.covered} of {coverage.total} covered
          </span>
        )}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {coverage === null
          ? requirements.map((text) => (
              <li
                key={text}
                className="rounded-xl border-[1.5px] border-hairline px-[11px] py-2 text-sm font-semibold lg:py-[9px]"
              >
                {text}
              </li>
            ))
          : coverage.items.map((r) => (
              <li
                key={r.text}
                aria-label={`${r.text}: ${r.covered ? `covered by ${r.by ?? "the design"}` : "nothing covers this yet"}`}
                className={
                  r.covered
                    ? "rounded-xl bg-[color-mix(in_srgb,var(--go)_14%,var(--page))] px-[11px] py-2 text-go-text lg:py-[9px]"
                    : "rounded-xl border-[1.5px] border-dashed border-(--system-design-line) px-[11px] py-2 text-(--system-design-line) lg:py-[9px]"
                }
              >
                <span
                  aria-hidden="true"
                  className="flex items-start justify-between gap-2 text-sm font-semibold"
                >
                  {r.text}
                  {r.covered ? (
                    <Mark d="m5 12.5 4.5 4.5L19 7.5" />
                  ) : (
                    <Mark d="M12 3 2 20h20zM12 9v5M12 17h.01" />
                  )}
                </span>
                <span aria-hidden="true" className="mt-0.5 block text-xs">
                  {r.covered ? r.by : "Nothing covers this yet"}
                </span>
              </li>
            ))}
      </ul>
    </section>
  );
}

function Mark({ d }: { d: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <path d={d} />
    </svg>
  );
}
