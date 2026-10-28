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

    reading: async (userId, bookId, sessionId) => {
      const sessions = await db
        .selectFrom("book_session as s")
        .innerJoin("book_chapter as c", "c.id", "s.chapter_id")
        .innerJoin("book as b", "b.id", "c.book_id")
        .leftJoin("book_session_finished as f", "f.session_id", "s.id")
        .select([
          "s.id",
          "s.title",
          "s.estimated_minutes",
          "s.first_page",
          "s.last_page",
          "c.title as chapter_title",
          "b.title as book_title",
          sql<boolean>`f.session_id is not null`.as("finished"),
        ])
        .where("b.id", "=", bookId)
        .where("b.user_id", "=", userId)
        .where("b.status", "=", "ready")
        .orderBy("c.ordinal")
        .orderBy("s.ordinal")
        .execute();
      if (sessions.length === 0) return null;
      const saved = await db
        .selectFrom("book_position")
        .select(["session_id", "fraction"])
        .where("book_id", "=", bookId)
        .executeTakeFirst();
      // A session named that isn't in the book (a stale link) is ignored.
      const named = sessions.some((s) => s.id === sessionId) ? sessionId : null;
      // A place in a section since finished (Mark done) gives way to what's next.
      const place = sessions.find((s) => s.id === saved?.session_id);
      const chosen =
        named ??
        (place !== undefined && !place.finished ? place.id : undefined) ??
        (sessions.find((s) => !s.finished) ?? sessions[0])?.id;
      const i = sessions.findIndex((s) => s.id === chosen);
      const session = sessions[i];
      if (session === undefined) return null;
      return {
        bookId,
        bookTitle: session.book_title,
        chapterTitle: session.chapter_title,
        sessionId: session.id,
        title: session.title,
        minutes: session.estimated_minutes,
        firstPage: session.first_page,
        lastPage: session.last_page,
        finished: session.finished,
        fraction: saved?.session_id === session.id ? saved.fraction : null,
        previous: sessions[i - 1]?.id ?? null,
        next: sessions[i + 1]?.id ?? null,
        place: i + 1,
        of: sessions.length,
      };
    },

    // One statement: only a session of the user's ready book is marked, once (LOAD-5).
    finish: async (userId, sessionId) => {
      const { rows } = await sql<{ book_id: string; added: boolean }>`
        with owned as (
          select b.id as book_id from book_session s
          join book_chapter c on c.id = s.chapter_id
          join book b on b.id = c.book_id
          where s.id = ${sessionId} and b.user_id = ${userId}
            and b.status = 'ready'
        ),
        added as (
          insert into book_session_finished (session_id)
          select ${sessionId} from owned
          on conflict (session_id) do nothing
          returning session_id
        )
        select book_id, exists (select 1 from added) as added from owned
      `.execute(db);
      const row = rows[0];
      return row === undefined
        ? null
        : { bookId: row.book_id, firstTime: row.added };
    },

    savePosition: async (userId, bookId, sessionId, fraction) => {
      const { rows } = await sql<{ book_id: string }>`
        insert into book_position (book_id, session_id, fraction)
        select b.id, s.id, ${fraction}
        from book b
        join book_chapter c on c.book_id = b.id
        join book_session s on s.chapter_id = c.id
        where b.id = ${bookId} and b.user_id = ${userId} and b.status = 'ready'
          and s.id = ${sessionId}
        on conflict (book_id) do update
          set session_id = excluded.session_id, fraction = excluded.fraction,
              updated_at = now()
        returning book_id
      `.execute(db);
      return rows.length > 0;
    },

    fileKey: async (userId, bookId) => {
      const row = await db
        .selectFrom("book")
        .select("file_key")
        .where("id", "=", bookId)
        .where("user_id", "=", userId)
        .where("status", "=", "ready")
        .executeTakeFirst();
      return row?.file_key ?? null;
    },

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
