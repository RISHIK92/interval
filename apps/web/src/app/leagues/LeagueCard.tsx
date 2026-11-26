import type { LeagueTier } from "@interval/db";
import Link from "next/link";
import { TIER_NAMES } from "../../server/leagues";
import type { LeagueCohort } from "../../server/ports";
import { TierMark } from "./TierMark";

// ADR-0045 (Play hub, web): the player's league at a glance, linking to Leagues: the
// time left, their row between their neighbours', and the zone they're in. Phones show
// it inline on Play, which is how they reach Leagues.
export function LeagueCard({
  tier,
  cohort,
  userId,
  left,
  className = "",
}: {
  tier: LeagueTier;
  cohort: LeagueCohort | null;
  userId: string;
  left: { days: number; hours: number };
  className?: string;
}) {
  const at = cohort?.rows.findIndex((r) => r.userId === userId) ?? -1;
  const near =
    cohort === null || at < 0
      ? []
      : cohort.rows.slice(Math.max(0, at - 1), at + 2);
  const rank = at < 0 ? null : (cohort?.rows[at]?.rank ?? null);
  const zone =
    cohort === null || rank === null
      ? null
      : rank <= cohort.up
        ? `In the promotion zone · top ${String(cohort.up)} move up`
        : rank > cohort.rows.length - cohort.down
          ? `In the demotion zone · bottom ${String(cohort.down)} move down`
          : null;
  return (
    <Link
      href="/leagues"
      className={`flex flex-col gap-3 rounded-[22px] border border-hairline bg-card p-[18px] shadow-card ${className}`}
    >
      <span className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-well">
          <TierMark tier={tier} />
        </span>
        <span>
          <span className="block text-[15px] leading-tight font-semibold">
            {TIER_NAMES[tier]} league
          </span>
          <span className="mt-0.5 block text-xs text-ink-muted tabular-nums">
            {`${String(left.days)} ${left.days === 1 ? "day" : "days"} ${String(left.hours)} h left`}
          </span>
        </span>
      </span>
      {near.length === 0 ? (
        <span className="text-[13px] leading-snug text-ink-soft">
          Your first points this week put you in a league.
        </span>
      ) : (
        <span className="flex flex-col gap-1 text-sm">
          {near.map((r) => (
            <span
              key={r.userId}
              className={`flex items-center gap-3 rounded-[10px] px-2.5 py-1.5 ${r.userId === userId ? "bg-ink font-bold text-page" : ""}`}
            >
              <span className="w-5 tabular-nums">{r.rank}</span>
              <span className="flex-1 truncate">
                {r.userId === userId ? "You" : (r.username ?? "Player")}
              </span>
              <span className="tabular-nums">{r.points}</span>
            </span>
          ))}
        </span>
      )}
      {zone === null ? null : (
        <span
          className={`text-[13px] font-semibold ${rank !== null && cohort !== null && rank <= cohort.up ? "text-go-text" : "text-wrong"}`}
        >
          {zone}
        </span>
      )}
    </Link>
  );
}
