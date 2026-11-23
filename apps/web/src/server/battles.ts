import { GENERATORS, ResultLine, Scenario } from "@interval/lld";
import { z } from "zod";
import { group } from "./battle-windows";
import { log } from "./log";
import type {
  BattleMatch,
  BattleWindows,
  BattleMode,
  FileStore,
  MatchHandoff,
  Matches,
  ProblemStore,
} from "./ports";

// P5-W31-S02b (§6.5, Q-P5-15; LLDQ-4, ADR-0033): an LLD battle for the game server. The
// game server can't generate harnesses (they're TS, packages/lld) or read the bucket, so
// the web app hands over everything a judge job needs: per language, the harness files
// for the base interface and, for after the reveal, the extended one; and every
// scenario with the reference's results. Like a quiz's keys, they stay in Valkey and the
// game server, and no client ever receives them.

// The private file the loader writes (problems.ts privateLayers), read back at the
// bucket boundary.
const PrivateLayers = z.object({
  slug: z.string(),
  scenarios: z.array(
    z.object({
      layer: z.enum(["visible", "hidden", "concurrency", "extension"]),
      index: z.int().min(0),
      scenario: Scenario,
      results: z.array(ResultLine),
    }),
  ),
});

export async function startBattle(
  deps: {
    store: ProblemStore;
    files: FileStore;
    matches: Pick<Matches, "createBattle">;
    handoff: MatchHandoff;
  },
  serverId: number,
  slug: string,
  players: string[],
  // P5-W32: a casual or solo battle is unrated (Q-P5-19); P5-W33: its battle mode (Q-P5-20).
  options?: { unrated?: boolean; battleMode?: BattleMode },
): Promise<string> {
  // C-03: a 1v1 or a room of up to 4; one alone for solo play (P5-W32).
  if (
    players.length === 0 ||
    players.length > 4 ||
    new Set(players).size !== players.length
  )
    throw new Error("a battle needs 1 to 4 distinct players");
  const problem = await deps.store.get(slug);
  if (problem === null) throw new Error(`no such problem: ${slug}`);
  const file = await deps.files.get(problem.privateKey);
  if (file === null || file === "unchanged")
    throw new Error(`${slug}: its private file is missing; load the problems`);
  let layers: z.infer<typeof PrivateLayers>;
  try {
    layers = PrivateLayers.parse(
      JSON.parse(await new Response(file.body).text()),
    );
  } catch (error) {
    throw new Error(
      `${slug}: its private file is unreadable; load the problems`,
      {
        cause: error,
      },
    );
  }
  const languages: BattleMatch["battle"]["languages"] = {};
  const starters: Record<string, string> = {};
  const baseStarters: Record<string, string> = {};
  for (const [language, generate] of Object.entries(GENERATORS)) {
    const base = generate(problem.interface);
    const extended =
      problem.extension === null ? null : generate(problem.extension.interface);
    // One solution file for both: an extension adds methods to the same class (W31-S02a),
    // so Java's file, named after the class, is the same too.
    if (extended !== null && extended.solutionFile !== base.solutionFile)
      throw new Error(`${slug}: the extension renames the solution file`);
    if (extended !== null) starters[language] = extended.starter;
    baseStarters[language] = base.starter;
    languages[language] = {
      solution: base.solutionFile,
      base: [{ name: base.harnessFile, content: base.harness }],
      extension:
        extended === null
          ? []
          : [{ name: extended.harnessFile, content: extended.harness }],
    };
  }
  // The match row first (it names the problem, ADR-0033): tickets and the worker's
  // record find it by this id.
  const match: BattleMatch = {
    id: await deps.matches.createBattle(serverId, players, slug, options),
    players,
    battle: {
      problem: slug,
      battle_mode: options?.battleMode ?? "human",
      starters: baseStarters,
      limits: problem.limits,
      checks: problem.checks,
      languages,
      scenarios: layers.scenarios.map((s) => ({
        layer: s.layer,
        stdin: JSON.stringify(s.scenario),
        expected: s.results,
      })),
      ...(problem.extension === null
        ? {}
        : {
            extension: { statement: problem.extension.statement, starters },
          }),
    },
  };
  try {
    await deps.handoff.putBattle(match);
  } catch (error) {
    // As a quiz match's (live.ts): its server can't play it without the definition.
    log.error("game: battle not handed over", { matchId: match.id, error });
    throw error;
  }
  return match.id;
}

// P5-W33 (Q-P5-20): a request's battle mode (?mode=), human when absent; null when it
// names no battle mode. ADR-0047: a link from before the rename says ?league=, read as
// ?mode= when that is absent. The read stays: only the lobbies' own API calls ever sent
// ?league= (they now send ?mode=), but a lobby loaded before the rename, in an open tab
// or the PWA's cached bundle, still does, and this keeps no state with which to read it
// "once". With nothing deployed (ADR-0013), no stored link depends on it.
export function battleModeOf(request: Request): BattleMode | null {
  const params = new URL(request.url).searchParams;
  const battleMode = params.get("mode") ?? params.get("league") ?? "human";
  return battleMode === "human" || battleMode === "ai" ? battleMode : null;
}

// P5-W32 (Q-P5-19): a live problem at random from the battle mode's pool (P5-W33), for a
// casual battle or a window.
export async function randomProblem(
  store: ProblemStore,
  battleMode: BattleMode,
): Promise<string> {
  const slugs = await store.pool(battleMode);
  const slug = slugs[Math.floor(Math.random() * slugs.length)];
  if (slug === undefined)
    throw new Error(`no live ${battleMode}-mode problems: load them first`);
  return slug;
}

// P5-W32 (§6.6, MATCH-7; Q-P5-19): a window's battles, made by the first poll at or after
// its start: registrants by room rating into rooms of 4 (3, 2, or one alone, unranked),
// all on the window's problem. A group whose battle fails stays ungrouped (logged) and a
// poll a minute on tries it again. Returns how many were registered and how many are in
// a battle with others (the 80% matched metric) and whether this was the window's first
// grouping, or null when another poll has it.
export async function groupWindow(
  deps: Parameters<typeof startBattle>[0] & { windows: BattleWindows },
  windowAt: Date,
  battleMode: BattleMode,
  now: () => Date,
): Promise<{ grouped: number; matched: number; first: boolean } | null> {
  const claimed = await deps.windows.claim(windowAt, battleMode, now(), () =>
    randomProblem(deps.store, battleMode),
  );
  if (claimed === null) return null;
  let matched = 0;
  for (const players of group(claimed.players)) {
    const users = players.map((p) => p.userId);
    let matchId: string;
    try {
      matchId = await startBattle(deps, 0, claimed.problem, users, {
        unrated: users.length === 1,
        battleMode,
      });
    } catch (error) {
      log.error("battle: window group not started", {
        windowAt: windowAt.toISOString(),
        error,
      });
      continue;
    }
    // A battle started is assigned or the grouping fails loudly: never regrouped into
    // a second one by the next claim.
    await deps.windows.assign(windowAt, battleMode, matchId, users);
    await deps.windows.extend(windowAt, battleMode, now());
    if (users.length > 1) matched += users.length;
  }
  return { grouped: claimed.players.length, matched, first: claimed.first };
}
