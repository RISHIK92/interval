import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { gameEnv } from "../../../env";
import { entitlements, sessionReader } from "../../../server/container";
import { requireUsername } from "../../username/gate";
import { createChallengeAction } from "./actions";
import { ChallengeLink } from "./ChallengeLink";
import { TOKEN } from "./token";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

// P3-W17-S03 (Q-P3-16; owner, 2026-11-03): challenge a friend to a private live match,
// unrated. The link works 10 minutes, for one friend, while the sender is around
// (they're told on any open tab when the friend accepts).
export default async function ChallengePage(props: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!actor.isGuest) await requireUsername(actor.userId, "/play/challenge");
  const [live, sprint] = await Promise.all([
    entitlements().can(actor.userId, "play.live"),
    entitlements().can(actor.userId, "play.sprint"),
  ]);
  if (gameEnv() === null || !live) redirect("/play");
  const token = TOKEN.safeParse((await props.searchParams).t).data ?? null;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-12 lg:pt-10">
      <header>
        <h1 className="text-display">Challenge a friend</h1>
        <p className="mt-1 text-ink-muted">
          A private live match, just the two of you. It doesn&apos;t change
          ratings; what you miss still comes back as reading.
        </p>
      </header>
      {token === null ? (
        <form action={createChallengeAction} className="flex flex-col gap-3">
          <p className="font-semibold">Which game?</p>
          <div className="flex flex-wrap gap-3">
            {sprint ? (
              <button
                type="submit"
                name="mode"
                value="sprint"
                className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
              >
                60-second sprint
              </button>
            ) : null}
            <button
              type="submit"
              name="mode"
              value="fastest_finger"
              className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
            >
              Fastest finger
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Send this link to one friend</p>
          <ChallengeLink token={token} />
          <p className="text-sm text-ink-muted">
            It works for 10 minutes, for the first friend who opens it. Keep
            Interval open: when they accept, you&apos;ll get a &ldquo;Join
            now&rdquo; here or on any page.
          </p>
        </div>
      )}
      <Link href="/play" className="font-semibold underline underline-offset-2">
        Back to Play
      </Link>
    </main>
  );
}
