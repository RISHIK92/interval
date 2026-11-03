import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { guestLabel } from "../../../server/boards";
import {
  challenges,
  sessionReader,
  usernames,
} from "../../../server/container";
import { requireUsername } from "../../username/gate";
import { acceptChallengeAction } from "../../play/challenge/actions";
import { TOKEN } from "../../play/challenge/token";

export const dynamic = "force-dynamic";

const GAME = { sprint: "a 60-second sprint", fastest_finger: "fastest finger" };

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-10 pb-12">
      <h1 className="text-display">A live challenge</h1>
      {children}
    </main>
  );
}

// P3-W17-S03 (Q-P3-16, Q-P3-03; owner, 2026-11-03): a friend's challenge link. Opening
// it takes nothing: it says where the challenge stands, and "Play now" accepts it while
// its sender is online. Guests can play it too.
// A challenge is between two people: kept out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ChallengeLinkPage(props: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ failed?: string; unplayable?: string }>;
}) {
  const { token } = await props.params;
  const query = (await props.searchParams) ?? {};
  const here = `/c/${encodeURIComponent(token)}`;
  if (query.failed !== undefined)
    return (
      <Frame>
        <p role="status" className="rounded-2xl bg-well px-4 py-3">
          The match couldn&apos;t start. Ask your friend for a new link.
        </p>
      </Frame>
    );
  const actor = await sessionReader().current(await headers());
  if (actor === null)
    return (
      <Frame>
        <p>
          Someone challenged you to a live match. Sign in, or play as a guest
          from Play, then open this link again.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/sign-in"
            className="rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
          >
            Sign in
          </Link>
          <Link
            href="/play"
            className="rounded-full border border-hairline px-5 py-2.5 font-semibold"
          >
            Play as a guest
          </Link>
        </div>
      </Frame>
    );
  if (!actor.isGuest) await requireUsername(actor.userId, here);
  const valid = TOKEN.safeParse(token);
  const found = valid.success
    ? await challenges().peek(valid.data, actor.userId)
    : ({ status: "expired" } as const);
  if (found.status !== "open")
    return (
      <Frame>
        <p role="status" className="rounded-2xl bg-well px-4 py-3">
          {found.status === "expired"
            ? "This challenge has expired. Links work for 10 minutes: ask for a new one."
            : found.status === "taken"
              ? "Someone already accepted this challenge."
              : "This is your own challenge link: send it to a friend."}
        </p>
        <Link
          href="/play"
          className="font-semibold underline underline-offset-2"
        >
          Go to Play
        </Link>
      </Frame>
    );
  const [label] = await usernames().labels([found.sender]);
  const sender =
    label?.username != null
      ? `@${label.username}`
      : label?.guest === true
        ? guestLabel(found.sender)
        : "Your friend";
  if (query.unplayable !== undefined)
    return (
      <Frame>
        <p role="status" className="rounded-2xl bg-well px-4 py-3">
          This game isn&apos;t on both your plans, so it can&apos;t be played.
        </p>
      </Frame>
    );
  if (!(await challenges().online(found.sender)))
    return (
      <Frame>
        <p role="status" className="rounded-2xl bg-well px-4 py-3">
          {sender} isn&apos;t online right now. Ask them to open Interval, then
          open this link again; it works for 10 minutes.
        </p>
      </Frame>
    );
  return (
    <Frame>
      <p>
        {sender} challenged you to {GAME[found.mode]}. It&apos;s private and
        doesn&apos;t change ratings.
      </p>
      <form action={acceptChallengeAction}>
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
        >
          Play {sender} now
        </button>
      </form>
      <p className="text-sm text-ink-muted">
        They get a &ldquo;Join now&rdquo;; the match waits up to 60 seconds for
        them.
      </p>
    </Frame>
  );
}
