import { practiceProblems, rubricPoints } from "@interval/hld";
import type { HldJudgement } from "../../../server/ports";

// P6-W41 (CANVAS-6, Q-P6-05): a judgement as the canvas shows it: the levels (the
// owner's, once an appeal is resolved), the rubric points they make, and the coach's
// advice. Shared by the practice page and the judgement route.
export type FeedbackView = ReturnType<typeof feedbackView>;

export function feedbackView(j: HldJudgement) {
  const rubric =
    practiceProblems().find((p) => p.slug === j.problemSlug)?.rubric ?? [];
  const levels = j.ownerLevels ?? j.levels;
  return {
    id: j.id,
    status: j.status,
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
