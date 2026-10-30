import type { Capability } from "@interval/db";
import { headers } from "next/headers";
import Link from "next/link";
import {
  entitlements,
  preferences,
  sessionReader,
} from "../../server/container";
import { TabBar } from "../TabBar";
import { Card } from "../ui/Card";
import { GuestForm } from "./GuestForm";

export const dynamic = "force-dynamic";

// §6.3: the quick games, as the table words them. Estimation's full points are C-27's
// 1.25× (ADR-0006). Each game is its own capability (OPS-3), so a plan can leave one
// out; fastest finger is the live one. In §6.3's order.
const GAMES: {
  name: string;
  format: string;
  win: string;
  capability: Capability;
}[] = [
  {
    name: "Daily challenge",
    format: "Solo, the same set for everyone, one attempt",
    win: "Score and streak; the result shares as a card that doesn't reveal the questions",
    capability: "play.daily",
  },
  {
    name: "60-second sprint",
    format: "Solo or 1v1",
    win: "Most correct in 60 seconds",
    capability: "play.sprint",
  },
  {
    name: "Fastest finger",
    format: "1v1 live, 7 rounds",
    win: "First correct answer takes each round",
    capability: "play.live",
  },
  {
    name: "Estimation",
    format: "Solo or 1v1",
    win: "Scored by how many times off the answer is; full points within 1.25× of the answer",
    capability: "play.estimation",
  },
];

// P3-W13-S01: the Play tab (§6.1, §6.3). No game is playable yet; each one's own slice
// links it. Guests play here and only here (ADR-0029); signed-out visitors can start one.
export default async function PlayPage() {
  const actor = await sessionReader().current(await headers());
  const [allowed, chosen] =
    actor === null
      ? [null, null]
      : await Promise.all([
          Promise.all(
            GAMES.map((g) => entitlements().can(actor.userId, g.capability)),
          ),
          preferences().get(actor.userId),
        ]);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-[52rem] lg:pt-10 lg:pl-64">
      <header>
        <h1 className="text-display">Play</h1>
        <p className="mt-1 text-ink-muted">
          Quick games on what you read. What you miss comes back as reading.
        </p>
      </header>
      <TabBar current="play" firstName={chosen?.firstName ?? null} />
      {actor?.isGuest === true ? (
        <p className="text-sm text-ink-muted">
          <Link href="/sign-up" className="underline underline-offset-2">
            Sign up to keep your progress
          </Link>
        </p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {GAMES.map((game, index) => (
          <li key={game.name}>
            <Card className="flex h-full flex-col gap-2 p-5">
              <h2 className="text-title">{game.name}</h2>
              <p className="text-sm font-semibold">{game.format}</p>
              <p className="text-sm text-ink-muted">{game.win}</p>
              <p className="mt-auto pt-2 text-sm text-ink-muted">
                {allowed !== null && allowed[index] === false
                  ? "Not on your plan"
                  : "Coming later"}
              </p>
            </Card>
          </li>
        ))}
      </ul>
      {actor === null ? (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-title">Play without an account</h2>
          <p className="text-sm text-ink-muted">
            Interval is in private beta: a guest needs an invite code too.
          </p>
          <GuestForm />
          <p className="text-sm">
            Or{" "}
            <Link href="/join" className="font-semibold underline">
              join
            </Link>{" "}
            or{" "}
            <Link href="/sign-in" className="font-semibold underline">
              sign in
            </Link>
            .
          </p>
        </Card>
      ) : null}
    </main>
  );
}
