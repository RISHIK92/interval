import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { AdminTts, TtsRun } from "../ports";

// P4-W22-S03 (TTS-1): the blind test's latest complete run (five scripts, each said by
// every provider of the run), providers held back until every script has a pick.
const SCRIPTS = 5;
const RECENT_RUNS = 10;

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23505";
export function kyselyAdminTts(db: Kysely<DB>): AdminTts {
  return {
    latest: async () => {
      // The recent runs, newest first: the latest complete one is shown.
      const runs = await db
        .selectFrom("tts_sample")
        .select("run")
        .groupBy("run")
        .orderBy(sql`max(created_at)`, "desc")
        .limit(RECENT_RUNS)
        .execute();
      if (runs.length === 0) return null;
      const rows = await db
        .selectFrom("tts_sample")
        .select([
          "run",
          "id",
          "script_no",
          "voice_label",
          "provider",
          "picked_at",
        ])
        .where(
          "run",
          "in",
          runs.map((r) => r.run),
        )
        .orderBy("script_no")
        .orderBy("voice_label")
        .execute();
      const complete = (run: string) => {
        const mine = rows.filter((r) => r.run === run);
        const providers = new Set(mine.map((r) => r.provider)).size;
        return (
          providers >= 2 &&
          Array.from({ length: SCRIPTS }, (_, i) => i + 1).every(
            (n) => mine.filter((r) => r.script_no === n).length === providers,
          )
        );
      };
      const at = runs.findIndex((r) => complete(r.run));
      if (at === -1) return null;
      const run = runs[at]?.run ?? "";
      const mine = rows.filter((r) => r.run === run);
      const numbers = Array.from({ length: SCRIPTS }, (_, i) => i + 1);
      const revealed = numbers.every((n) =>
        mine.some((r) => r.script_no === n && r.picked_at !== null),
      );
      const scripts: TtsRun["scripts"] = numbers.map((n) => ({
        scriptNo: n,
        voices: mine
          .filter((r) => r.script_no === n)
          .map((r) => ({
            id: r.id,
            label: r.voice_label as "A" | "B" | "C",
            picked: r.picked_at !== null,
            provider: revealed ? r.provider : null,
          })),
      }));
      const tally = revealed
        ? [...new Set(mine.map((r) => r.provider))]
            .map((provider) => ({
              provider,
              picks: mine.filter(
                (r) => r.provider === provider && r.picked_at !== null,
              ).length,
            }))
            .sort((a, b) => b.picks - a.picks)
        : [];
      return { run, newerStopped: at > 0, scripts, revealed, tally };
    },
    pick: async (sampleId, by) => {
      // One pick a script (the partial unique index); a second is refused, not moved.
      const picked = await db
        .updateTable("tts_sample as s")
        .set({ picked_at: sql<Date>`now()`, picked_by: by })
        .where("s.id", "=", sampleId)
        .where("s.picked_at", "is", null)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("tts_sample as o")
                .select("o.id")
                .whereRef("o.run", "=", "s.run")
                .whereRef("o.script_no", "=", "s.script_no")
                .where("o.picked_at", "is not", null),
            ),
          ),
        )
        .executeTakeFirst()
        // Two picks at the same moment both pass the check; the index refuses one.
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) return { numUpdatedRows: 0n };
          throw error;
        });
      return picked.numUpdatedRows > 0n;
    },
    fileKey: async (sampleId) => {
      const row = await db
        .selectFrom("tts_sample")
        .select("file_key")
        .where("id", "=", sampleId)
        .executeTakeFirst();
      return row?.file_key ?? null;
    },
  };
}
