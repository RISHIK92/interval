import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { TabBar } from "../TabBar";

// The design's page headings on wide screens: 34 px on the pages in the frame, 32 px on
// the Play pages a level in (the boards, a challenge, the live games). Phones keep the
// mobile design's display size.
export const PAGE_TITLE =
  "text-display lg:text-[34px] lg:leading-[1.1] lg:tracking-[-0.03em]";
export const INNER_PAGE_TITLE =
  "text-display lg:text-[32px] lg:leading-[1.1] lg:tracking-[-0.03em]";

// One card in the right rail: a link when it leads somewhere. A tinted card (the
// design's "cards are fading") passes its background in place of the bordered card.
export function RailCard({
  href,
  surface = "border border-hairline bg-card",
  className = "",
  children,
}: {
  href?: string;
  surface?: string;
  className?: string; // the card's own layout (flex, gaps)
  children: ReactNode;
}) {
  const look = `rounded-[22px] px-[18px] py-4 ${surface} ${className}`;
  return href === undefined ? (
    <div className={look}>{children}</div>
  ) : (
    <Link href={href} className={`block ${look}`}>
      {children}
    </Link>
  );
}

// The web design's page frame (ADR-0019): the sidebar, a main column and, on pages that
// have one, a right rail of cards. Phones keep the mobile design: one column above the
// tab bar, and the rail's cards stay off them (the page shows its own versions inline).
export function Page({
  tab,
  firstName,
  rail,
  railLabel = "At a glance",
  className = "",
  phoneTabBar = true,
  children,
}: {
  tab: ComponentProps<typeof TabBar>["current"];
  firstName: string | null;
  rail?: ReactNode;
  railLabel?: string;
  className?: string; // the main column's own layout (flex, gaps)
  phoneTabBar?: boolean; // false: a page that never had the phone tab bar
  children: ReactNode;
}) {
  return (
    <div
      className={`mx-auto max-w-xl px-4 pt-6 ${phoneTabBar ? "pb-[calc(6rem+env(safe-area-inset-bottom))]" : "pb-12"} lg:max-w-none lg:p-0 lg:pl-50`}
    >
      <div className="lg:mx-auto lg:flex lg:max-w-250 lg:items-start">
        <main className={`min-w-0 lg:flex-1 lg:px-8 lg:py-7 ${className}`}>
          {children}
        </main>
        {rail === undefined ? null : (
          <aside
            aria-label={railLabel}
            className="hidden lg:flex lg:w-65 lg:shrink-0 lg:flex-col lg:gap-3 lg:py-7 lg:pr-6"
          >
            {rail}
          </aside>
        )}
      </div>
      <TabBar current={tab} firstName={firstName} phone={phoneTabBar} />
    </div>
  );
}
