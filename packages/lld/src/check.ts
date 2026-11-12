import { z } from "zod";

// P5-W29-S03 (EXEC-4, Q-P5-07): how a method's results are compared with the
// reference's, set per method in a problem (W30). Without one, results are exact.
// - exact: the same JSON value, numbers compared as numbers (3 equals 3.0).
// - unordered: a list result compared as a multiset (an order the problem leaves open).
// - approx: every number within the tolerance, relative to its size, with an absolute
//   floor of the same amount near zero.
// A tolerance belongs to approx only: the checker refuses one on another comparison as
// the problem's own fault (ErrProblem), since a refinement here wouldn't reach Go.
export const Check = z.strictObject({
  method: z.string().min(1).max(31),
  compare: z.enum(["exact", "unordered", "approx"]),
  tolerance: z.number().positive().max(0.1).optional(),
});
export type Check = z.infer<typeof Check>;
