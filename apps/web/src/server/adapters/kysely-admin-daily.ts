import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { AdminDaily, DailySet, DailySetQuestion } from "../ports";

const TODAY = sql`(now() at time zone 'utc')::date`;

// P3-W13-S05 (ADR-0031): the owner's review of tomorrow's set. The pick rule is the
// database's (daily_challenge_fit), shared with the worker's pick (ARCH-2).
export function kyselyAdminDaily(db: Kysely<DB>): AdminDaily {
  return {
    sets: async () => {
      const { rows: days } = await sql<{
        day: string;
        today: boolean;
        approved: boolean;
        unreviewed: boolean;
      }>`
        select day::text, day = ${TODAY} as today,
               approved_at is not null as approved,
               published_unreviewed_at is not null as unreviewed
        from daily_challenge where day in (${TODAY}, ${TODAY} + 1)
      `.execute(db);
      const { rows: questions } = await sql<
        Omit<DailySetQuestion, "questionId"> & {
          day: string;
          question_id: string;
        }
      >`
        select d.day::text, d.position, q.id as question_id, q.kind, q.stem,
               q.status, coalesce(ci.title, q.source_title, '') as source,
               array(select c.name from question_concept qc
                 join concept c on c.id = qc.concept_id
                 where qc.question_id = q.id order by c.name) as concepts
        from daily_challenge_question d
        join question q on q.id = d.question_id
        left join moment m on m.id = q.moment_id
        left join content_item ci on ci.id = m.content_item_id
        where d.day in (${TODAY}, ${TODAY} + 1)
        order by d.position
      `.execute(db);
      const set = (today: boolean): DailySet | null => {
        const row = days.find((d) => d.today === today);
        return row === undefined
          ? null
          : {
              day: row.day,
              approved: row.approved,
              publishedUnreviewed: row.unreviewed,
              questions: questions
                .filter((q) => q.day === row.day)
                .map((q) => ({
                  position: q.position,
                  questionId: q.question_id,
                  kind: q.kind,
                  stem: q.stem,
                  status: q.status,
                  concepts: q.concepts,
                  source: q.source,
                })),
            };
      };
      return { today: set(true), tomorrow: set(false) };
    },

    approve: async (day) => {
      const done = await db
        .updateTable("daily_challenge")
        .set({ approved_at: sql<Date>`coalesce(approved_at, now())` })
        .where(sql<boolean>`day = ${day}::date and day > ${TODAY}`)
        .executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },

    swap: async (day, position) => {
      const { rows } = await sql<{ swapped: boolean }>`
        select daily_challenge_swap(${day}::date, ${position}::smallint) as swapped
      `.execute(db);
      return rows[0]?.swapped === true;
    },
  };
}
