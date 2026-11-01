import { cache } from "react";
import { quizzes } from "../../../server/container";
import type { DailyShare } from "../../../server/ports";
import { streakText } from "../../streakText";

// P3-W13-S06 (§6.3): a shared daily result, for its page and its preview image alike.
// A malformed id is no share, without asking the database. Cached per request: the
// page and its metadata both read it.
const SHARE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const byId = cache((share: string): Promise<DailyShare | null> =>
  SHARE_ID.test(share) ? quizzes().dailyShare(share) : Promise.resolve(null),
);

export const loadShare = async (
  params: Promise<{ share: string }>,
): Promise<DailyShare | null> => byId((await params).share);

export const shareText = (share: DailyShare) => ({
  day: new Date(`${share.day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }),
  points: `${String(share.points)} points`,
  streak: streakText(share.streak),
});

// What a screen reader hears for a dot.
export const dotLabel = (dot: number): string =>
  dot === 1
    ? "right"
    : dot === 0
      ? "missed"
      : `${String(Math.round(dot * 100))} points`;
