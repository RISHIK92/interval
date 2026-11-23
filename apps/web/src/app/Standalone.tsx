import type { ReactNode } from "react";

// The pages outside the app's tabs (signing in, a shared result, a challenge link, the
// username, offline). Wide screens: the web design's full-screen frame, as Onboarding,
// web: the wordmark in a bar across the top, the page in a card centred under it.
// Phones keep the mobile design: the page alone. The page's <main> keeps its own centring
// and width (max-w-md, as the design's 448 px card).
export const CARD =
  "lg:mt-14 lg:mb-16 lg:w-full lg:rounded-3xl lg:border lg:border-hairline lg:bg-card lg:p-9 lg:shadow-card";

// A page's title on wide screens, as the design's headings.
export const TITLE = "lg:text-[32px] lg:leading-[1.1] lg:tracking-[-0.03em]";

export function Standalone({
  className,
  children,
}: {
  className: string; // the <main>'s own layout
  children: ReactNode;
}) {
  return (
    <>
      <header className="hidden items-center gap-2.5 border-b border-hairline px-7 py-[18px] text-[22px] leading-none font-bold tracking-[-0.03em] lg:flex">
        <span
          aria-hidden="true"
          className="flex size-[30px] items-center justify-center gap-[3px] rounded-[9px] bg-ink"
        >
          <span className="h-3.5 w-1 rounded-sm bg-page" />
          <span className="mb-2 size-1.5 self-end rounded-full bg-go" />
        </span>
        Interval
      </header>
      <main className={className}>{children}</main>
    </>
  );
}
