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
