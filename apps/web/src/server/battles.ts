import { GENERATORS, ResultLine, Scenario } from "@interval/lld";
import { z } from "zod";
import { log } from "./log";
import type {
  BattleMatch,
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
): Promise<string> {
  if (players.length === 0 || new Set(players).size !== players.length)
    throw new Error("a battle needs distinct players");
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
  for (const [language, generate] of Object.entries(GENERATORS)) {
    const base = generate(problem.interface);
    const extended =
      problem.extension === null ? null : generate(problem.extension.interface);
    // One solution file for both: an extension adds methods to the same class (W31-S02a),
    // so Java's file, named after the class, is the same too.
    if (extended !== null && extended.solutionFile !== base.solutionFile)
      throw new Error(`${slug}: the extension renames the solution file`);
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
    id: await deps.matches.createBattle(serverId, players, slug),
    players,
    battle: {
      problem: slug,
      limits: problem.limits,
      checks: problem.checks,
      languages,
      scenarios: layers.scenarios.map((s) => ({
        layer: s.layer,
        stdin: JSON.stringify(s.scenario),
        expected: s.results,
      })),
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
