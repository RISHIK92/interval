import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyBooks } from "./kysely-books";

// A user's private PDF books (§5F, Q-P2-34, P2-W11-S01).
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(
  body: (trx: Transaction<DB>, users: [string, string]) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `BOOK${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 2,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const users: [string, string] = [randomUUID(), randomUUID()];
      for (const id of users)
        await trx
          .insertInto("app_user")
          .values({
            id,
            name: "n",
            email: `${id}@example.test`,
            beta_group: "student",
            invite_code_id: code.id,
          })
          .execute();
      await body(trx, users);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("the beta plan allows 5 books per user; a sixth is refused", async () => {
  await inRollback(async (trx, [me, other]) => {
    const books = kyselyBooks(trx);
    for (const n of [1, 2, 3, 4, 5])
      expect(
        await books.create(
          me,
          `Book ${String(n)}`,
          100,
          `books/${me}/${String(n)}.pdf`,
        ),
      ).toMatchObject({ bookId: expect.stringMatching(/^\d+$/) as unknown });
    expect(await books.create(me, "Six", 100, `books/${me}/6.pdf`)).toBe(
      "limit",
    );
    // Another user's count is their own.
    expect(
      await books.create(other, "Mine", 100, `books/${other}/1.pdf`),
    ).toMatchObject({ bookId: expect.stringMatching(/^\d+$/) as unknown });
  });
});

test("the list is the user's own, newest first; only the owner removes a book", async () => {
  await inRollback(async (trx, [me, other]) => {
    const books = kyselyBooks(trx);
    const first = await books.create(me, "First", 100, `books/${me}/a.pdf`);
    const second = await books.create(me, "Second", 200, `books/${me}/b.pdf`);
    await books.create(other, "Theirs", 100, `books/${other}/c.pdf`);
    expect((await books.list(me)).map((b) => [b.title, b.status])).toEqual([
      ["Second", "processing"],
      ["First", "processing"],
    ]);
    if (first === "limit" || second === "limit") throw new Error("seed");
    expect(await books.remove(other, first.bookId)).toBeNull();
    expect(await books.remove(me, first.bookId)).toBe(`books/${me}/a.pdf`);
    expect(await books.remove(me, first.bookId)).toBeNull();
    expect((await books.list(me)).map((b) => b.title)).toEqual(["Second"]);
  });
});

test("two uploads at once with one place left: exactly one is refused", async () => {
  const userId = randomUUID();
  const code = await db
    .insertInto("invite_code")
    .values({
      code: `BOOK${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      beta_group: "student",
      max_uses: 1,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("app_user")
    .values({
      id: userId,
      name: "n",
      email: `${userId}@example.test`,
      beta_group: "student",
      invite_code_id: code.id,
    })
    .execute();
  try {
    // Separate connections, as two requests would be: the advisory lock serializes.
    const books = kyselyBooks(db);
    for (const n of [1, 2, 3, 4])
      await books.create(userId, "b", 1, `books/${userId}/${String(n)}.pdf`);
    const results = await Promise.all(
      ["x", "y"].map((n) =>
        books.create(userId, n, 1, `books/${userId}/${n}.pdf`),
      ),
    );
    expect(results.filter((r) => r === "limit")).toHaveLength(1);
  } finally {
    await db.deleteFrom("app_user").where("id", "=", userId).execute();
    await db.deleteFrom("invite_code").where("id", "=", code.id).execute();
  }
});

test("no books.count grant means none; a null limit means no limit", async () => {
  await inRollback(async (trx, [me]) => {
    const books = kyselyBooks(trx);
    await trx
      .updateTable("plan_capability")
      .set({ limit_value: null })
      .where("plan_id", "=", "beta")
      .where("capability", "=", "books.count")
      .execute();
    for (const n of [1, 2, 3, 4, 5, 6])
      expect(
        await books.create(me, "b", 1, `books/${me}/${String(n)}.pdf`),
      ).not.toBe("limit");
    await trx
      .deleteFrom("plan_capability")
      .where("plan_id", "=", "beta")
      .where("capability", "=", "books.count")
      .execute();
    expect(await books.create(me, "b", 1, `books/${me}/7.pdf`)).toBe("limit");
  });
});

// P2-W11-S04 (§5F, Q-P2-31): reading a ready book's sessions.
async function aReadyBook(
  trx: Transaction<DB>,
  userId: string,
): Promise<{ bookId: string; sessions: string[] }> {
  const book = await trx
    .insertInto("book")
    .values({
      user_id: userId,
      title: "Designing Data Systems",
      file_key: `books/${userId}/${randomUUID()}.pdf`,
      size_bytes: 100,
      status: "ready",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const sessions: string[] = [];
  for (const [ordinal, title] of ["Replication", "Partitioning"].entries()) {
    const chapter = await trx
      .insertInto("book_chapter")
      .values({ book_id: book.id, ordinal, title })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const n of [0, 1]) {
      const session = await trx
        .insertInto("book_session")
        .values({
          chapter_id: chapter.id,
          ordinal: n,
          title: `${title} ${String(n + 1)}`,
          text: `First paragraph of ${title}.\n\nSecond <b>paragraph</b>.`,
          estimated_minutes: 4,
          first_page: 2 * ordinal + n + 1,
          last_page: 2 * ordinal + n + 2,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      sessions.push(session.id);
    }
  }
  return { bookId: book.id, sessions };
}

test("a book opens where the user left off, else the first unfinished, else the first", async () => {
  await inRollback(async (trx, [me]) => {
    const books = kyselyBooks(trx);
    const { bookId, sessions } = await aReadyBook(trx, me);
    const [s1, s2, s3, s4] = sessions;
    if (!s1 || !s2 || !s3 || !s4) throw new Error("seed");
    expect(await books.reading(me, bookId, null)).toMatchObject({
      sessionId: s1,
      bookTitle: "Designing Data Systems",
      chapterTitle: "Replication",
      title: "Replication 1",
      minutes: 4,
      firstPage: 1,
      lastPage: 2,
      previous: null,
      next: s2,
      place: 1,
      of: 4,
      finished: false,
      fraction: null,
    });
    expect(await books.finish(me, s1)).toEqual({ bookId, firstTime: true });
    expect(await books.finish(me, s1)).toEqual({ bookId, firstTime: false });
    expect((await books.reading(me, bookId, null))?.sessionId).toBe(s2);
    // Across chapters, and a saved place wins.
    expect(await books.savePosition(me, bookId, s3, 0.4)).toBe(true);
    expect(await books.reading(me, bookId, null)).toMatchObject({
      sessionId: s3,
      chapterTitle: "Partitioning",
      previous: s2,
      next: s4,
      fraction: 0.4,
    });
    // A session named outright; its fraction only when it's the saved one.
    expect(await books.reading(me, bookId, s4)).toMatchObject({
      sessionId: s4,
      next: null,
      fraction: null,
    });
    expect((await books.reading(me, bookId, s1))?.finished).toBe(true);
    // A place in a section since marked done gives way to the next unfinished.
    await books.finish(me, s3);
    expect((await books.reading(me, bookId, null))?.sessionId).toBe(s2);
  });
});

test("someone else's book, a book not ready, or a session not in it: nothing", async () => {
  await inRollback(async (trx, [me, other]) => {
    const books = kyselyBooks(trx);
    const { bookId, sessions } = await aReadyBook(trx, me);
    const [s1] = sessions;
    if (!s1) throw new Error("seed");
    expect(await books.reading(other, bookId, null)).toBeNull();
    expect(await books.finish(other, s1)).toBeNull();
    expect(await books.savePosition(other, bookId, s1, 0.5)).toBe(false);
    const theirs = await aReadyBook(trx, other);
    // A session from another book (a stale link) is ignored: the opening rule.
    expect(
      (await books.reading(me, bookId, theirs.sessions[0] ?? ""))?.sessionId,
    ).toBe(s1);
    expect(await books.fileKey(other, bookId)).toBeNull();
    expect(await books.fileKey(me, bookId)).toMatch(/^books\//);
    expect(
      await books.savePosition(me, bookId, theirs.sessions[0] ?? "", 0.5),
    ).toBe(false);
    await trx
      .updateTable("book")
      .set({ status: "ocr" })
      .where("id", "=", bookId)
      .execute();
    expect(await books.reading(me, bookId, null)).toBeNull();
    expect(await books.savePosition(me, bookId, s1, 0.5)).toBe(false);
    expect(await books.finish(me, s1)).toBeNull();
    expect(await books.fileKey(me, bookId)).toBeNull();
  });
});

// P2-W11-S05 (§5F, Q-P2-33): books followed like paths.
test("a book's outline: chapters, sessions ticked, and where it opens", async () => {
  await inRollback(async (trx, [me, other]) => {
    const books = kyselyBooks(trx);
    const { bookId, sessions } = await aReadyBook(trx, me);
    const [s1, s2, s3, s4] = sessions;
    if (!s1 || !s2 || !s3 || !s4) throw new Error("seed");
    expect((await books.outlines(me))[0]).toMatchObject({
      started: false,
      next: s1,
    });
    // A saved place alone counts as started.
    await books.savePosition(me, bookId, s1, 0.1);
    expect((await books.outlines(me))[0]?.started).toBe(true);
    await books.finish(me, s1);
    expect(await books.outlines(me)).toEqual([
      {
        bookId,
        title: "Designing Data Systems",
        done: 1,
        of: 4,
        first: s1,
        started: true,
        next: s2,
        chapters: [
          {
            title: "Replication",
            sessions: [
              {
                sessionId: s1,
                title: "Replication 1",
                minutes: 4,
                finished: true,
              },
              {
                sessionId: s2,
                title: "Replication 2",
                minutes: 4,
                finished: false,
              },
            ],
          },
          {
            title: "Partitioning",
            sessions: [
              {
                sessionId: s3,
                title: "Partitioning 1",
                minutes: 4,
                finished: false,
              },
              {
                sessionId: s4,
                title: "Partitioning 2",
                minutes: 4,
                finished: false,
              },
            ],
          },
        ],
      },
    ]);
    // The saved place wins, until that section is marked done.
    await books.savePosition(me, bookId, s4, 0.3);
    expect((await books.outlines(me))[0]?.next).toBe(s4);
    await books.finish(me, s4);
    expect((await books.outlines(me))[0]?.next).toBe(s2);
    for (const s of [s2, s3]) await books.finish(me, s);
    expect((await books.outlines(me))[0]).toMatchObject({
      done: 4,
      next: null,
    });
    // Someone else's, or a book not ready: not listed.
    expect(await books.outlines(other)).toEqual([]);
    await trx
      .updateTable("book")
      .set({ status: "ocr" })
      .where("id", "=", bookId)
      .execute();
    expect(await books.outlines(me)).toEqual([]);
  });
});

test("the feed's book: the one read last, a new one counting from when it was added", async () => {
  await inRollback(async (trx, [me, other]) => {
    const books = kyselyBooks(trx);
    const older = await aReadyBook(trx, me);
    const newer = await aReadyBook(trx, me);
    const at = (iso: string) => sql<Date>`${iso}::timestamptz`;
    await trx
      .updateTable("book")
      .set({ created_at: at("2026-10-01") })
      .where("id", "=", older.bookId)
      .execute();
    await trx
      .updateTable("book")
      .set({ created_at: at("2026-10-10") })
      .where("id", "=", newer.bookId)
      .execute();
    // Not opened yet: the newer book, from its first session.
    expect(await books.nextSession(me)).toMatchObject({
      bookId: newer.bookId,
      sessionId: newer.sessions[0],
      chapterTitle: "Replication",
      title: "Replication 1",
      firstPage: 1,
      lastPage: 2,
      place: 1,
      of: 4,
    });
    // Reading the older book later makes it the one.
    const [o1, o2, o3, o4] = older.sessions;
    if (!o1 || !o2 || !o3 || !o4) throw new Error("seed");
    await books.finish(me, o1);
    await trx
      .updateTable("book_session_finished")
      .set({ finished_at: at("2026-10-20") })
      .where("session_id", "=", o1)
      .execute();
    expect(await books.nextSession(me)).toMatchObject({
      bookId: older.bookId,
      sessionId: o2,
      place: 2,
    });
    // A saved place counts as reading too.
    await books.savePosition(me, newer.bookId, newer.sessions[2] ?? "", 0.5);
    await trx
      .updateTable("book_position")
      .set({ updated_at: at("2026-10-21") })
      .where("book_id", "=", newer.bookId)
      .execute();
    expect(await books.nextSession(me)).toMatchObject({
      bookId: newer.bookId,
      sessionId: newer.sessions[2],
    });
    // A finished book is passed over.
    for (const s of newer.sessions) await books.finish(me, s);
    expect((await books.nextSession(me))?.bookId).toBe(older.bookId);
    expect(await books.nextSession(other)).toBeNull();
  });
});

test("the feed's book: a tie goes to the newer book; its place is the saved session", async () => {
  await inRollback(async (trx, [me]) => {
    const books = kyselyBooks(trx);
    const first = await aReadyBook(trx, me);
    const second = await aReadyBook(trx, me);
    // Same moment for both (one transaction): the later-added one wins.
    expect((await books.nextSession(me))?.bookId).toBe(second.bookId);
    // A place saved in the second chapter while the first is unfinished.
    await books.savePosition(me, first.bookId, first.sessions[3] ?? "", 0.2);
    await trx
      .updateTable("book_position")
      .set({ updated_at: sql<Date>`now() + interval '1 minute'` })
      .execute();
    expect(await books.nextSession(me)).toMatchObject({
      bookId: first.bookId,
      sessionId: first.sessions[3],
      chapterTitle: "Partitioning",
      place: 4,
    });
  });
});
