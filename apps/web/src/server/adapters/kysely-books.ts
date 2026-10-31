import type { DB } from "@interval/db";
import { type Kysely, type RawBuilder, sql } from "kysely";
import {
  type BookOutline,
  type Books,
  CHECKPOINT_SIZE,
  STUCK_MINUTES,
} from "../ports";

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
      const book = (await readyBooks(db, userId, bookId))[0];
      if (book === undefined) return null;
      const { sessions, saved } = book;
      // A session named that isn't in the book (a stale link) is ignored.
      const named = sessions.find((s) => s.id === sessionId);
      const session = named ?? opensAt(book) ?? sessions[0];
      if (session === undefined) return null;
      const i = sessions.indexOf(session);
      return {
        bookId,
        bookTitle: book.title,
        chapterTitle: session.chapter_title,
        sessionId: session.id,
        title: session.title,
        minutes: session.estimated_minutes,
        firstPage: session.first_page,
        lastPage: session.last_page,
        finished: session.finished_at !== null,
        fraction: saved?.session_id === session.id ? saved.fraction : null,
        previous: sessions[i - 1]?.id ?? null,
        next: sessions[i + 1]?.id ?? null,
        place: i + 1,
        of: sessions.length,
      };
    },

    outlines: async (userId) =>
      (await readyBooks(db, userId, null)).map((book) => {
        const chapters: BookOutline["chapters"] = [];
        let chapterId: string | null = null;
        for (const s of book.sessions) {
          if (s.chapter_id !== chapterId) {
            chapterId = s.chapter_id;
            chapters.push({
              chapterId: s.chapter_id,
              title: s.chapter_title,
              checkpoint:
                s.checkpoint_state === null
                  ? null
                  : { state: s.checkpoint_state, passed: s.last_passed },
              sessions: [],
            });
          }
          chapters.at(-1)?.sessions.push({
            sessionId: s.id,
            title: s.title,
            minutes: s.estimated_minutes,
            finished: s.finished_at !== null,
          });
        }
        return {
          bookId: book.id,
          title: book.title,
          done: book.sessions.filter((s) => s.finished_at !== null).length,
          of: book.sessions.length,
          first: book.sessions[0]?.id ?? "",
          started:
            book.saved !== undefined ||
            book.sessions.some((s) => s.finished_at !== null),
          next: opensAt(book)?.id ?? null,
          chapters,
        };
      }),

    nextSession: async (userId) => {
      // The book read last: its newest saved place or Mark done; a book not yet
      // opened counts from when it was added.
      const active = (book: ReadyBook) =>
        Math.max(
          book.createdAt.getTime(),
          book.saved?.updated_at.getTime() ?? 0,
          ...book.sessions.map((s) => s.finished_at?.getTime() ?? 0),
        );
      const candidates = (await readyBooks(db, userId, null))
        .map((book) => ({ book, session: opensAt(book) }))
        .filter((c) => c.session !== undefined)
        .sort((x, y) => active(y.book) - active(x.book));
      const top = candidates[0];
      if (top?.session === undefined) return null;
      const { book, session } = top;
      return {
        bookId: book.id,
        bookTitle: book.title,
        chapterTitle: session.chapter_title,
        sessionId: session.id,
        title: session.title,
        minutes: session.estimated_minutes,
        firstPage: session.first_page,
        lastPage: session.last_page,
        place: book.sessions.indexOf(session) + 1,
        of: book.sessions.length,
      };
    },

    // One statement: only a session of the user's ready book is marked, once (LOAD-5).
    finish: async (userId, sessionId) => {
      const { rows } = await sql<{
        book_id: string;
        added: boolean;
        chapter_done: string | null;
      }>`
        with owned as (
          select b.id as book_id, c.id as chapter_id from book_session s
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
        -- The insert isn't visible here: every other session of the chapter done.
        -- Two last sessions marked at the same instant each miss the other's row,
        -- so neither asks for the checkpoint; the chapter's end offers it then.
        select book_id, exists (select 1 from added) as added,
          case when not exists (
            select 1 from book_session o
            where o.chapter_id = owned.chapter_id and o.id <> ${sessionId}
              and not exists (
                select 1 from book_session_finished f where f.session_id = o.id
              )
          ) then chapter_id end as chapter_done
        from owned
      `.execute(db);
      const row = rows[0];
      return row === undefined
        ? null
        : {
            bookId: row.book_id,
            firstTime: row.added,
            chapterDone: row.chapter_done,
          };
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

    requestCheckpoint: async (userId, chapterId) => {
      const { rows } = await sql<{ requests: number }>`
        insert into book_chapter_checkpoint (chapter_id)
        select c.id from book_chapter c
        join book b on b.id = c.book_id
        where c.id = ${chapterId} and b.user_id = ${userId} and b.status = 'ready'
          and ${chapterFinished(sql`c.id`)}
        on conflict (chapter_id) do update set
          status = 'preparing', failure = null, ready_at = null,
          requests = book_chapter_checkpoint.requests + 1, requested_at = now()
        where book_chapter_checkpoint.status = 'failed'
          or (book_chapter_checkpoint.status = 'preparing'
            and book_chapter_checkpoint.requested_at
              < now() - make_interval(mins => ${STUCK_MINUTES}))
        returning requests
      `.execute(db);
      return rows[0]?.requests ?? null;
    },

    checkpoint: async (userId, chapterId) => {
      const { rows } = await sql<{
        book_id: string;
        book_title: string;
        title: string;
        finished: boolean;
        state: "preparing" | "ready" | "failed" | null;
        stuck: boolean;
        failure: string | null;
        size: number;
        concepts: string[];
        last_passed: boolean | null;
        last_correct: number | null;
        last_size: number | null;
        next_id: string | null;
        next_title: string | null;
      }>`
        select b.id as book_id, b.title as book_title, c.title,
          ${chapterFinished(sql`c.id`)} as finished,
          k.status as state,
          coalesce(k.status = 'preparing' and k.requested_at
            < now() - make_interval(mins => ${STUCK_MINUTES}), false) as stuck,
          k.failure,
          least(${CHECKPOINT_SIZE}, (select count(*)::int from question q
            where q.book_chapter_id = c.id and q.status = 'live'
              and q.kind = 'choice')) as size,
          array(select n.name from book_chapter_concept bc
            join concept n on n.id = bc.concept_id and n.retired_at is null
            where bc.chapter_id = c.id order by n.name) as concepts,
          last.checkpoint_passed as last_passed, last.correct as last_correct,
          last.checkpoint_size as last_size,
          next.id as next_id, next.title as next_title
        from book_chapter c
        join book b on b.id = c.book_id and b.status = 'ready'
        left join book_chapter_checkpoint k on k.chapter_id = c.id
        left join lateral (
          select a.checkpoint_passed, a.checkpoint_size,
            (select count(*)::int from quiz_answer qa
              where qa.attempt_id = a.id and qa.correct) as correct
          from quiz_attempt a
          where a.user_id = ${userId} and a.book_chapter_id = c.id
            and a.finished_at is not null
          order by a.finished_at desc limit 1
        ) last on true
        left join lateral (
          select s.id, s.title from book_chapter nc
          join book_session s on s.chapter_id = nc.id
          where nc.book_id = c.book_id and nc.ordinal > c.ordinal
          order by nc.ordinal, s.ordinal limit 1
        ) next on true
        where c.id = ${chapterId} and b.user_id = ${userId}
      `.execute(db);
      const row = rows[0];
      if (row === undefined) return null;
      return {
        bookId: row.book_id,
        bookTitle: row.book_title,
        chapterId,
        title: row.title,
        finished: row.finished,
        state: row.state ?? "none",
        stuck: row.stuck,
        failure: row.failure,
        size: row.size,
        concepts: row.concepts,
        last:
          row.last_passed === null ||
          row.last_correct === null ||
          row.last_size === null
            ? null
            : {
                passed: row.last_passed,
                correct: row.last_correct,
                size: row.last_size,
              },
        next:
          row.next_id === null || row.next_title === null
            ? null
            : { sessionId: row.next_id, title: row.next_title },
      };
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

// A user's ready books (one, or all), each with its sessions in reading order (never
// their text: a book's sessions can run to megabytes) and its saved place.
async function readyBooks(
  db: Kysely<DB>,
  userId: string,
  bookId: string | null,
) {
  let query = db
    .selectFrom("book as b")
    .innerJoin("book_chapter as c", "c.book_id", "b.id")
    .innerJoin("book_session as s", "s.chapter_id", "c.id")
    .leftJoin("book_session_finished as f", "f.session_id", "s.id")
    .select([
      "b.id as book_id",
      "b.title as book_title",
      "b.created_at as book_created_at",
      "c.id as chapter_id",
      "c.title as chapter_title",
      "s.id",
      "s.title",
      "s.estimated_minutes",
      "s.first_page",
      "s.last_page",
      "f.finished_at",
      sql<"preparing" | "ready" | "failed" | null>`(
        select k.status from book_chapter_checkpoint k
        where k.chapter_id = c.id)`.as("checkpoint_state"),
      sql<boolean | null>`(
        select a.checkpoint_passed from quiz_attempt a
        where a.user_id = ${userId} and a.book_chapter_id = c.id
          and a.finished_at is not null
        order by a.finished_at desc limit 1)`.as("last_passed"),
    ])
    .where("b.user_id", "=", userId)
    .where("b.status", "=", "ready");
  if (bookId !== null) query = query.where("b.id", "=", bookId);
  const [rows, places] = await Promise.all([
    query
      .orderBy("b.created_at", "desc")
      .orderBy("b.id", "desc")
      .orderBy("c.ordinal")
      .orderBy("s.ordinal")
      .execute(),
    db
      .selectFrom("book_position as p")
      .innerJoin("book as b", "b.id", "p.book_id")
      .select(["p.book_id", "p.session_id", "p.fraction", "p.updated_at"])
      .where("b.user_id", "=", userId) // one row a book, at most five
      .execute(),
  ]);
  const books = new Map<string, ReadyBook>();
  for (const row of rows) {
    const book = books.get(row.book_id) ?? {
      id: row.book_id,
      title: row.book_title,
      createdAt: row.book_created_at,
      saved: places.find((p) => p.book_id === row.book_id),
      sessions: [],
    };
    books.set(row.book_id, book);
    book.sessions.push(row);
  }
  return [...books.values()];
}
type ReadyBook = {
  id: string;
  title: string;
  createdAt: Date;
  saved: { session_id: string; fraction: number; updated_at: Date } | undefined;
  sessions: {
    id: string;
    chapter_id: string;
    chapter_title: string;
    title: string;
    estimated_minutes: number;
    first_page: number;
    last_page: number;
    finished_at: Date | null;
    checkpoint_state: "preparing" | "ready" | "failed" | null;
    last_passed: boolean | null; // the user's latest attempt at its checkpoint
  }[];
};

// Where a book opens with no session named (§5F): the saved place, unless that
// section has since been marked done, else the first unfinished; none once all are.
function opensAt(book: ReadyBook): ReadyBook["sessions"][number] | undefined {
  const place = book.sessions.find((s) => s.id === book.saved?.session_id);
  return place !== undefined && place.finished_at === null
    ? place
    : book.sessions.find((s) => s.finished_at === null);
}

// Every session of the chapter marked done (Q-P2-35: its checkpoint is made then).
const chapterFinished = (
  chapter: RawBuilder<unknown>,
) => sql<boolean>`not exists (
  select 1 from book_session s
  where s.chapter_id = ${chapter}
    and not exists (select 1 from book_session_finished f where f.session_id = s.id)
)`;
