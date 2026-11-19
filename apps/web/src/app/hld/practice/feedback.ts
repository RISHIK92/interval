import { problemBySlug, rubricPoints } from "@interval/hld";
import { HLD_STALE_MINUTES, type HldJudgement } from "../../../server/ports";

// P6-W41 (CANVAS-6, Q-P6-05): a judgement as the canvas shows it: the levels (the
// owner's, once an appeal is resolved), the rubric points they make, and the coach's
// advice. Shared by the practice page and the judgement route.
export type FeedbackView = ReturnType<typeof feedbackView>;

export function feedbackView(j: HldJudgement) {
  const rubric = problemBySlug(j.problemSlug)?.rubric ?? [];
  const levels = j.ownerLevels ?? j.levels;
  return {
    id: j.id,
    // A request lost on the way shows as unavailable, so the player can ask again.
    status:
      j.status === "pending" &&
      Date.now() - j.requestedAt.getTime() > HLD_STALE_MINUTES * 60_000
        ? ("unavailable" as const)
        : j.status,
    baselinePassed: j.baselinePassed,
    criteria: rubric.map((c) => ({
      id: c.id,
      criterion: c.criterion,
      level: levels?.[c.id]?.level ?? null,
      reason: levels?.[c.id]?.reason ?? null,
    })),
    rubricPoints: levels === null ? null : rubricPoints(rubric, levels),
    coach: j.coach,
    appealed: j.appealedAt !== null,
    regraded: j.ownerLevels !== null,
  };
}
