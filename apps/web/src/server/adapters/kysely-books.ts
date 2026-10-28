import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { Books } from "../ports";

// A user's private PDF books (§5F, DB-6, P2-W11-S01).
// Kysely can't nest transactions: inside one (as the tests run), use it.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

export function kyselyBooks(db: Kysely<DB>): Books {
  return {
    list: async (userId) =>
      (
        await db
          .selectFrom("book")
          .select(["id", "title", "status", "failure", "created_at"])
          .where("user_id", "=", userId)
          .orderBy("created_at", "desc")
          .orderBy("id", "desc")
          .execute()
      ).map((r) => ({
        bookId: r.id,
        title: r.title,
        status: r.status,
        failure: r.failure,
        createdAt: r.created_at,
      })),

    // OPS-3, Q-P2-34: the plan's books.count. One upload at a time per user, so two
    // at once can't both take the last place.
    create: (userId, title, sizeBytes, fileKey) =>
      inTransaction(db, async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtext(${`book:${userId}`}))`.execute(
          trx,
        );
        // A capability without a row isn't granted; a null limit is no limit.
        const { rows } = await sql<{
          allowed: number | null;
          used: number;
          granted: boolean;
        }>`
          select
            (select limit_value from user_entitlement
             where user_id = ${userId} and capability = 'books.count') as allowed,
            (select count(*)::int from book where user_id = ${userId}) as used,
            exists (select 1 from user_entitlement
                    where user_id = ${userId} and capability = 'books.count') as granted
        `.execute(trx);
        const row = rows[0];
        if (
          row === undefined ||
          !row.granted ||
          (row.allowed !== null && row.used >= row.allowed)
        )
          return "limit";
        const book = await trx
          .insertInto("book")
          .values({
            user_id: userId,
            title,
            size_bytes: sizeBytes,
            file_key: fileKey,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { bookId: book.id };
      }),

    remove: async (userId, bookId) => {
      const gone = await db
        .deleteFrom("book")
        .where("id", "=", bookId)
        .where("user_id", "=", userId)
        .returning("file_key")
        .executeTakeFirst();
      return gone?.file_key ?? null;
    },
  };
}
