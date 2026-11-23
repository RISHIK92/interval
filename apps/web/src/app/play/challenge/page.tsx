import type { Metadata } from "next";
import { INNER_PAGE_TITLE, Page } from "../../ui/Page";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { gameEnv } from "../../../env";
import type { ReactNode } from "react";
import {
  entitlements,
  preferences,
  sessionReader,
} from "../../../server/container";
import { requireUsername } from "../../username/gate";
import { createChallengeAction } from "./actions";
import { ChallengeLink } from "./ChallengeLink";
import { TOKEN } from "./token";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Play hub's line icons for the two live games (Play hub, web).
const line = (path: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);
// Phones: the black pill. Wide screens: Play hub's game tile, its icon in a tinted square.
const GAME =
  "cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page lg:flex lg:min-h-[7.5rem] lg:w-56 lg:flex-col lg:items-start lg:justify-between lg:gap-4 lg:rounded-[20px] lg:border lg:border-hairline lg:bg-card lg:p-4 lg:text-left lg:text-[17px] lg:text-ink lg:shadow-card lg:hover:border-hairline-strong";
const ICON = "hidden size-10 items-center justify-center rounded-xl lg:flex";

// P3-W17-S03 (Q-P3-16; owner, 2026-11-03): challenge a friend to a private live match,
// unrated. The link works 10 minutes, for one friend, while the sender is around
// (they're told on any open tab when the friend accepts).
export default async function ChallengePage(props: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!actor.isGuest) await requireUsername(actor.userId, "/play/challenge");
  const [live, sprint, chosen] = await Promise.all([
    entitlements().can(actor.userId, "play.live"),
    entitlements().can(actor.userId, "play.sprint"),
    preferences().get(actor.userId),
  ]);
  if (gameEnv() === null || !live) redirect("/play");
  const token = TOKEN.safeParse((await props.searchParams).t).data ?? null;
  return (
    <Page
      phoneTabBar={false}
      tab="play"
      firstName={chosen?.firstName ?? null}
      className="flex flex-col gap-6 lg:max-w-[42rem]"
    >
      <header>
        <h1 className={INNER_PAGE_TITLE}>Challenge a friend</h1>
        <p className="mt-1 text-ink-muted lg:mt-1.5">
          A private live match, just the two of you. It doesn&apos;t change
          ratings; what you miss still comes back as reading.
        </p>
      </header>
      {token === null ? (
        <form action={createChallengeAction} className="flex flex-col gap-3">
          <p className="font-semibold lg:text-section">Which game?</p>
          <div className="flex flex-wrap gap-3">
            {sprint ? (
              <button type="submit" name="mode" value="sprint" className={GAME}>
                <span
                  className={`${ICON} bg-(--distributed-systems-tint) text-(--distributed-systems-line)`}
                >
                  {line(
                    <>
                      <circle cx="12" cy="13" r="8" />
                      <path d="M12 9v4l2.5 2M10 2h4" />
                    </>,
                  )}
                </span>
                60-second sprint
              </button>
            ) : null}
            <button
              type="submit"
              name="mode"
              value="fastest_finger"
              className={GAME}
            >
              <span className={`${ICON} bg-live/10 text-wrong`}>
                {line(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />)}
              </span>
              Fastest finger
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 lg:rounded-[20px] lg:border lg:border-hairline lg:bg-card lg:p-5 lg:shadow-card">
          <p className="font-semibold lg:text-section">
            Send this link to one friend
          </p>
          <ChallengeLink token={token} />
          <p className="text-sm text-ink-muted">
            It works for 10 minutes, for the first friend who opens it. Keep
            Interval open: when they accept, you&apos;ll get a &ldquo;Join
            now&rdquo; here or on any page.
          </p>
        </div>
      )}
      {/* The sidebar's Play does this on wide screens. */}
      <Link
        href="/play"
        className="font-semibold underline underline-offset-2 lg:hidden"
      >
        Back to Play
      </Link>
    </Page>
  );
}
