import type { ReactNode } from "react";
import type { BattleMode } from "../server/ports";
import { BATTLE_MODE_NAMES } from "./battle-mode";
import { RailCard } from "./ui/Page";

// A battle lobby's rail card, as the Play hub's rating card: the player's 1v1 rating in
// each battle mode (1500 before a first rated battle), and what the lobby adds under it.
export function BattleRatingCard({
  kind,
  ratings,
  children,
}: {
  kind: string; // which battles: "LLD", "System design"
  ratings: Record<BattleMode, number>;
  children?: ReactNode;
}) {
  return (
    <RailCard
      surface="border border-hairline bg-card shadow-card"
      className="flex flex-col gap-3"
    >
      <div>
        <p className="font-semibold">Battle rating</p>
        <p className="text-[13px] text-ink-muted">{kind}, 1v1</p>
      </div>
      <dl className="flex flex-col gap-1.5">
        {(["human", "ai"] as const).map((m) => (
          <div
            key={m}
            className="flex items-center justify-between rounded-[10px] bg-well px-3 py-2"
          >
            <dt className="text-sm">{BATTLE_MODE_NAMES[m]}</dt>
            <dd className="text-[17px] font-bold tabular-nums">
              {Math.round(ratings[m])}
            </dd>
          </div>
        ))}
      </dl>
      {children}
    </RailCard>
  );
}
