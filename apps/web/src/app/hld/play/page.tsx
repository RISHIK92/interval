import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { windowTimeZone } from "../../../env";
import { windowStatus, windowsFrom } from "../../../server/battle-windows";
import {
  entitlements,
  hldDeps,
  hldMatches,
  hldWindows,
  preferences,
  sessionReader,
} from "../../../server/container";
import type { BattleMode } from "../../../server/ports";
import { BattleRatingCard } from "../../BattleRatingCard";
import { LobbyCard, TROPHY } from "../../LobbyCard";
import { PAGE_TITLE, Page, RailCard } from "../../ui/Page";
import { advance } from "../../../server/hld-matches";
import { HldLobby } from "./HldLobby";

export const dynamic = "force-dynamic";

// P6-W42 (§6.4, MATCH-7; Q-P6-06): where HLD battles start. The player's own matches
// left unscored move on here too (ADR-0043), so leaving a match never strands it.
export default async function HldPlayPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const deps = hldDeps();
  const open = await hldMatches().unscoredFor(actor.userId);
  for (const id of open) await advance(deps, id);
  // A match still being played: where the lobby sends a player refused a second solo.
  const going = (
    await Promise.all(
      (await hldMatches().unscoredFor(actor.userId)).map((id) =>
        hldMatches().get(id),
      ),
    )
  ).find((f) => f !== null && f.match.closedAt === null);
  const now = new Date();
  const [next] = windowsFrom(now, windowTimeZone());
  if (next === undefined) throw new Error("no window in the coming week");
  const [mine, chosen, human, ai] = await Promise.all([
    hldWindows().registration(next, actor.userId),
    preferences().get(actor.userId),
    // The 1v1 HLD rating in each battle mode, as the casual queue bands by it.
    hldMatches().ratingOf(actor.userId, "human"),
    hldMatches().ratingOf(actor.userId, "ai"),
  ]);
  return (
    <Page
      tab="play"
      phoneTabBar={false}
      firstName={chosen?.firstName ?? null}
      railLabel="Your battles"
      rail={<HldRail ratings={{ human, ai }} />}
    >
      {/* The sidebar's Play does this on wide screens. */}
      <Link
        href="/play"
        className="mb-3 inline-block text-sm text-ink-muted underline lg:hidden"
      >
        Back to Play
      </Link>
      <HldLobby
        openMatch={
          going === undefined || going === null
            ? null
            : {
                id: going.match.id,
                deadline: going.match.deadlineAt.toISOString(),
              }
        }
        header={
          <header>
            <h1 className={PAGE_TITLE}>System design battles</h1>
            <p className="mt-1 text-ink-muted">
              Design a system against the clock: simulation 60, the AI rubric
              25, speed 15. Best on a desktop browser.{" "}
              {/* Phones' ways on, as before the web design; wide screens have the
                  rail's spec card and the practice and tournament cards. */}
              <span className="lg:hidden">
                <Link href="/hld/spec" className="underline underline-offset-2">
                  The spec sheet
                </Link>{" "}
                ·{" "}
                <Link
                  href="/hld/practice"
                  className="underline underline-offset-2"
                >
                  Practice
                </Link>{" "}
                ·{" "}
                <Link
                  href="/hld/tournaments"
                  className="underline underline-offset-2"
                >
                  Tournaments
                </Link>
              </span>
            </p>
          </header>
        }
        window={{
          at: next.toISOString(),
          status: windowStatus(next, now),
          registered: mine !== null,
          battleMode: mine?.battleMode ?? null,
          matchId: mine?.matchId ?? null,
        }}
      >
        <li className="hidden lg:block">
          <LobbyCard
            title="Practice"
            meta="No clock"
            art={PENCIL}
            tint="bg-(--distributed-systems-tint) text-(--distributed-systems-right)"
            body="Design any problem on the canvas, with its simulation live as you draw. No opponent."
          >
            <Link href="/hld/practice" className={QUIET}>
              Practice
            </Link>
          </LobbyCard>
        </li>
        <li className="hidden lg:block">
          <LobbyCard
            title="Tournaments"
            meta="Swiss, top 8"
            art={TROPHY}
            tint="bg-(--review-tint) text-(--review-line)"
            body="Five Swiss rounds, then a bracket of the top 8, with university standings."
          >
            <Link href="/hld/tournaments" className={QUIET}>
              Tournaments
            </Link>
          </LobbyCard>
        </li>
      </HldLobby>
    </Page>
  );
}

// The Play hub's quieter way in, as a link.
const QUIET =
  "inline-flex items-center rounded-full border border-hairline px-5 py-2.5 font-semibold lg:rounded-xl lg:border-[1.5px] lg:border-hairline-strong lg:px-4 lg:py-2 lg:text-sm";

const PENCIL = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-[30px]"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
  </svg>
);

// The wide layout's rail: the player's HLD ratings, and the spec sheet to study.
function HldRail({ ratings }: { ratings: Record<BattleMode, number> }) {
  return (
    <>
      <BattleRatingCard kind="System design" ratings={ratings} />
      <RailCard href="/hld/spec" className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold">The spec sheet</span>
        <span className="text-[13px] text-ink-muted">
          Every component&apos;s numbers, as the simulator uses them.
        </span>
      </RailCard>
    </>
  );
}
