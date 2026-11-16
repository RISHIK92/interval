import {
  Design,
  drawVariant,
  fitsProblem,
  judgeInput,
  matchProblem,
  rubricIncluded,
  rubricPoints,
  simulate,
  speedPoints,
  standings,
  starterDesign,
  type HldProblem,
} from "@interval/hld";
import { log } from "./log";
import type {
  HldJudgements,
  HldMatch,
  HldMatches,
  HldSeat,
  HldWindows,
  JobQueue,
  League,
} from "./ports";
import { group } from "./battle-windows";

// P6-W42 (§6.4, CANVAS-5, MATCH-7; Q-P6-06, ADR-0043): an HLD match, run by the web app.
// The official score is the preview's simulator, run here. A match moves on whenever
// anyone looks at it (`advance`): closed at its deadline (the last version of anyone who
// hadn't submitted is submitted for them), then scored once every judgement is in or
// JUDGE_WAIT has passed, then queued for its ratings.

export const JUDGE_WAIT_MS = 15 * 60_000; // Q-P6-06

export type HldDeps = {
  matches: HldMatches;
  judgements: HldJudgements;
  queue: JobQueue;
  now: () => Date;
  random: () => number;
};

export async function startHldMatch(
  deps: HldDeps,
  players: string[],
  league: League,
  options: {
    unrated: boolean;
    windowAt: Date | null;
    // A window's own variant; otherwise one drawn from the pool.
    variant?: { family: string; seed: number };
  },
): Promise<string> {
  const variant =
    options.variant ??
    drawVariant(league, deps.random, await deps.matches.retired(league));
  const problem = problemOf({ ...variant, league });
  return deps.matches.create(
    players,
    { ...variant, league },
    {
      unrated: options.unrated,
      windowAt: options.windowAt,
      minutes: problem.timeLimitMinutes,
    },
  );
}

// P6-W42 (MATCH-7, Q-P6-06): a ranked window's grouping, as LLD's (groupWindow): its
// ungrouped registrants by HLD room rating into rooms of up to 4 on one variant; one
// left alone plays solo, unrated. Null when another caller has the claim.
export async function groupHldWindow(
  deps: HldDeps & { windows: HldWindows },
  windowAt: Date,
  league: League,
): Promise<{ grouped: number; matched: number } | null> {
  const retired = await deps.matches.retired(league);
  const claimed = await deps.windows.claim(windowAt, league, deps.now(), () =>
    drawVariant(league, deps.random, retired),
  );
  if (claimed === null) return null;
  let matched = 0;
  for (const players of group(claimed.players)) {
    const users = players.map((p) => p.userId);
    let matchId: string;
    try {
      matchId = await startHldMatch(deps, users, league, {
        unrated: users.length === 1,
        windowAt,
        variant: claimed.variant,
      });
    } catch (error) {
      log.error("hld: window group not started", {
        windowAt: windowAt.toISOString(),
        error,
      });
      continue;
    }
    // A match started is assigned or the grouping fails loudly: never regrouped.
    await deps.windows.assign(windowAt, league, matchId, users);
    await deps.windows.extend(windowAt, league, deps.now());
    if (users.length > 1) matched += users.length;
  }
  return { grouped: claimed.players.length, matched };
}

export function problemOf(
  m: Pick<HldMatch, "family" | "league" | "seed">,
): HldProblem {
  const problem = matchProblem(m.family, m.league, m.seed);
  // Matches are only made from the pool, and the pool's test keeps every seed valid.
  if (problem === null)
    throw new Error(
      `hld: ${m.family}/${m.league}/${String(m.seed)} isn't in the pool`,
    );
  return problem;
}

// The design simulated and the submission recorded, once. Its judgement is asked for
// afterwards (`judgeSubmissions`), only by whoever recorded it, so two requests moving
// the match on can never both pay for one.
async function record(
  deps: HldDeps,
  match: HldMatch,
  userId: string,
  design: Design,
  auto: boolean,
): Promise<boolean> {
  const problem = problemOf(match);
  const at = deps.now();
  const result = simulate(problem, design);
  return deps.matches.submit(match.id, userId, {
    design,
    simulationPoints: result.points,
    baselinePassed: result.baselinePassed,
    speedPoints: speedPoints(
      match.startedAt,
      at,
      problem.timeLimitMinutes,
      result.baselinePassed,
      auto,
    ),
    auto,
    at,
  });
}

// Every submission's judgement (or, past a failed baseline, only the coach: §6.4),
// asked once and queued. The first request to claim a seat's judgement keeps it; a
// judgement that couldn't be queued is released, so the next look asks again.
async function judgeSubmissions(
  deps: HldDeps,
  match: HldMatch,
  seats: HldSeat[],
): Promise<void> {
  const problem = problemOf(match);
  for (const seat of seats) {
    if (seat.submittedAt === null || seat.judgementId !== null) continue;
    const design = Design.parse(seat.design); // written by `record` from a Design
    const result = simulate(problem, design);
    const asked = await deps.judgements.request(
      seat.userId,
      problem.slug,
      judgeInput(problem, design, result),
      result.baselinePassed,
      match.id,
    );
    if (!(await deps.matches.claimJudgement(match.id, seat.userId, asked.id))) {
      await deps.judgements.drop(asked.id); // another request claimed the seat first
      continue;
    }
    try {
      await deps.queue.enqueue(
        "judge_hld",
        { judgement_id: asked.id },
        { idempotencyKey: `hld-judge-${asked.id}` },
      );
    } catch (error) {
      log.error("hld: judgement not queued", { id: asked.id, error });
      await deps.matches.releaseJudgement(match.id, seat.userId, asked.id);
      await deps.judgements.drop(asked.id);
      throw error;
    }
  }
}

export async function submitDesign(
  deps: HldDeps,
  matchId: string,
  userId: string,
  raw: unknown,
): Promise<"submitted" | "already" | "closed" | "not_player" | "invalid"> {
  const found = await deps.matches.get(matchId);
  const seat = found?.seats.find((s) => s.userId === userId);
  if (found === null || seat === undefined) return "not_player";
  const { match } = found;
  if (match.closedAt !== null || deps.now() >= match.deadlineAt)
    return "closed";
  if (seat.submittedAt !== null) return "already";
  const design = Design.safeParse(raw);
  if (!design.success || fitsProblem(design.data, problemOf(match)).length > 0)
    return "invalid";
  if (!(await record(deps, match, userId, design.data, false))) return "closed"; // the deadline, or another tab, got there first
  await advance(deps, matchId);
  return "submitted";
}

export async function advance(deps: HldDeps, matchId: string): Promise<void> {
  const found = await deps.matches.get(matchId);
  if (found === null) return;
  const { match, seats } = found;
  if (match.scoredAt !== null) {
    await queueRating(deps, match, seats.length);
    return;
  }
  const now = deps.now();
  const waiting = seats.filter((s) => s.submittedAt === null);
  if (match.closedAt === null && waiting.length > 0 && now < match.deadlineAt) {
    await judgeSubmissions(deps, match, seats);
    return;
  }
  if (match.closedAt === null) {
    const problem = problemOf(match);
    for (const seat of waiting) {
      // Their last autosave, if it's a valid design for this problem; otherwise the
      // client alone, which scores nothing.
      const latest = await deps.matches.latestVersion(matchId, seat.userId);
      const parsed = Design.safeParse(latest?.design);
      const design =
        parsed.success && fitsProblem(parsed.data, problem).length === 0
          ? parsed.data
          : starterDesign();
      await record(deps, match, seat.userId, design, true);
    }
    await deps.matches.close(matchId, now);
  }
  const closed = await deps.matches.get(matchId);
  if (closed === null) return;
  await judgeSubmissions(deps, closed.match, closed.seats);
  await score(deps, matchId, now);
}

// A scored match's ratings, queued until the worker has rated it (the key keeps it to
// one job), so a queue that was down when it was scored can't leave it unrated.
async function queueRating(deps: HldDeps, match: HldMatch, players: number) {
  if (match.unrated || players < 2 || match.ratedAt !== null) return;
  await deps.queue.enqueue(
    "rate_hld_match",
    { match_id: match.id },
    { idempotencyKey: `hld-rate-${match.id}` },
  );
}

async function score(deps: HldDeps, matchId: string, now: Date): Promise<void> {
  const found = await deps.matches.get(matchId);
  if (found === null || found.match.closedAt === null) return;
  const { match, seats } = found;
  const closedAt = found.match.closedAt;
  const judgements = new Map(
    (await deps.judgements.ofMatch(match.id)).map((j) => [j.id, j]),
  );
  // Only graded designs wait: the rubric never counts for one that failed the baseline.
  const pending = seats.some(
    (s) =>
      s.baselinePassed === true &&
      (s.judgementId === null ||
        judgements.get(s.judgementId)?.status === "pending"),
  );
  if (pending && now.getTime() - closedAt.getTime() < JUDGE_WAIT_MS) return;
  const problem = problemOf(match);
  const entries = seats.map((s) => {
    if (s.submittedAt === null)
      throw new Error(`hld: ${match.id} closed with ${s.userId} unsubmitted`);
    const j =
      s.judgementId === null ? undefined : judgements.get(s.judgementId);
    const levels = j?.ownerLevels ?? j?.levels ?? null;
    return {
      userId: s.userId,
      simulation: s.simulationPoints ?? 0,
      speed: s.speedPoints ?? 0,
      rubric: levels === null ? null : rubricPoints(problem.rubric, levels),
      baselinePassed: s.baselinePassed ?? false,
      submittedAt: s.submittedAt,
    };
  });
  const included = rubricIncluded(entries);
  if (!included)
    // Q-P6-06, LOAD-5: observable; the AWS stack counts this line as a metric.
    log.warn("hld: match scored without the rubric", { matchId: match.id });
  if (
    await deps.matches.score(
      match.id,
      included,
      standings(entries, included),
      now,
    )
  )
    await queueRating(deps, match, seats.length);
}
