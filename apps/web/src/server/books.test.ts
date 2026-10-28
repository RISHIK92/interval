import { expect, test } from "vitest";
import { addBook, removeBook, titleOf } from "./books";
import type { Books, Entitlements, FileStore, JobQueue } from "./ports";
import { prepare } from "./queue";

// PDF books (§5F, Q-P2-34, P2-W11-S01): checked, stored privately, queued once.
const PDF = new TextEncoder().encode("%PDF-1.7\n%…");

function fakes(
  opts: {
    limit?: number;
    maxMb?: number;
    failPut?: boolean;
    failQueue?: boolean;
  } = {},
) {
  const rows = new Map<string, { userId: string; key: string }>();
  const stored = new Map<string, Uint8Array>();
  const queued: { name: string; message: unknown; key: string }[] = [];
  let next = 1;
  const books: Books = {
    list: () => Promise.resolve([]),
    reading: () => Promise.resolve(null),
    finish: () => Promise.resolve(null),
    savePosition: () => Promise.resolve(false),
    fileKey: () => Promise.resolve(null),
    outlines: () => Promise.resolve([]),
    nextSession: () => Promise.resolve(null),
    create: (userId, _title, _size, key) => {
      const mine = [...rows.values()].filter((r) => r.userId === userId);
      if (mine.length >= (opts.limit ?? 5)) return Promise.resolve("limit");
      const id = String(next++);
      rows.set(id, { userId, key });
      return Promise.resolve({ bookId: id });
    },
    remove: (userId, bookId) => {
      const row = rows.get(bookId);
      if (row?.userId !== userId) return Promise.resolve(null);
      rows.delete(bookId);
      return Promise.resolve(row.key);
    },
  };
  const files: FileStore = {
    get: () => Promise.resolve(null),
    // A put that fails may still have stored the file (a timeout): it's kept here.
    put: (key, bytes) => {
      stored.set(key, bytes);
      if (opts.failPut === true) return Promise.reject(new Error("s3 down"));
      return Promise.resolve();
    },
    remove: (key) => {
      stored.delete(key);
      return Promise.resolve();
    },
  };
  const queue: JobQueue = {
    enqueue: (name, message, { idempotencyKey }) => {
      // As the real queues check it (ADR-0014).
      prepare(name, message, idempotencyKey, 0);
      if (opts.failQueue === true)
        return Promise.reject(new Error("queue down"));
      queued.push({ name, message, key: idempotencyKey });
      return Promise.resolve();
    },
  };
  const entitlements: Entitlements = {
    can: () => Promise.resolve(true),
    limit: (_user, capability) =>
      Promise.resolve(
        capability === "books.max_mb" ? (opts.maxMb ?? 50) : null,
      ),
  };
  return { deps: { books, files, queue, entitlements }, rows, stored, queued };
}

test("a PDF is stored under the user's prefix, recorded, and queued once", async () => {
  const { deps, rows, stored, queued } = fakes();
  const added = await addBook(deps, "u1", { name: "DDIA.pdf", bytes: PDF });
  expect(added).toEqual({ ok: true, bookId: "1" });
  const [key] = [...stored.keys()];
  expect(key).toMatch(/^books\/u1\/[0-9a-f-]{36}\.pdf$/);
  expect(rows.get("1")?.key).toBe(key);
  expect(queued).toEqual([
    { name: "book_process", message: { book_id: 1 }, key: "book-1" },
  ]);
});

test("not a PDF, too large, or past the plan's count: refused, nothing stored", async () => {
  const notPdf = fakes();
  expect(
    await addBook(notPdf.deps, "u1", {
      name: "book.pdf",
      bytes: new TextEncoder().encode("PK\u0003\u0004 a zip"),
    }),
  ).toEqual({ ok: false, reason: "not_pdf" });
  expect(notPdf.stored.size).toBe(0);

  const big = fakes({ maxMb: 1 });
  const bytes = new Uint8Array(1024 * 1024 + 1);
  bytes.set(PDF);
  expect(await addBook(big.deps, "u1", { name: "big.pdf", bytes })).toEqual({
    ok: false,
    reason: "too_large",
  });
  expect(big.rows.size).toBe(0);

  const full = fakes({ limit: 1 });
  await addBook(full.deps, "u1", { name: "a.pdf", bytes: PDF });
  expect(await addBook(full.deps, "u1", { name: "b.pdf", bytes: PDF })).toEqual(
    { ok: false, reason: "limit" },
  );
  expect(full.stored.size).toBe(1);
  expect(full.queued).toHaveLength(1);
});

test("a failed store or queue leaves no book and no file behind", async () => {
  for (const failing of [{ failPut: true }, { failQueue: true }]) {
    const { deps, rows, stored, queued } = fakes(failing);
    await expect(
      addBook(deps, "u1", { name: "a.pdf", bytes: PDF }),
    ).rejects.toThrow(/down/);
    expect(rows.size).toBe(0);
    expect(stored.size).toBe(0);
    expect(queued).toEqual([]);
  }
});

test("removing a book queues its file's removal; someone else's isn't touched", async () => {
  const { deps, queued } = fakes();
  await addBook(deps, "u1", { name: "a.pdf", bytes: PDF });
  queued.length = 0;
  expect(await removeBook(deps, "u2", "1")).toEqual({ removed: false });
  expect(queued).toEqual([]);
  expect(await removeBook(deps, "u1", "1")).toEqual({
    removed: true,
    fileLeft: null,
  });
  const [removal] = queued;
  expect(removal?.name).toBe("remove_file");
  expect(JSON.stringify(removal?.message)).toMatch(
    /^\{"key":"books\/u1\/[0-9a-f-]{36}\.pdf"\}$/,
  );
  expect(removal?.key).toMatch(/^remove\/books\/u1\//);
});

test("when even the removal can't be queued, the book is gone and its file reported", async () => {
  const ok = fakes();
  await addBook(ok.deps, "u1", { name: "a.pdf", bytes: PDF });
  const failing = {
    ...ok.deps,
    queue: { enqueue: () => Promise.reject(new Error("queue down")) },
  };
  const result = await removeBook(failing, "u1", "1");
  if (!result.removed || result.fileLeft === null)
    throw new Error("expected a file left");
  expect(result.fileLeft.key).toMatch(/^books\/u1\//);
  expect(ok.rows.size).toBe(0);
});

test("the title is the file name until processing reads the PDF's own", () => {
  expect(titleOf("Designing Data-Intensive Applications.PDF")).toBe(
    "Designing Data-Intensive Applications",
  );
  expect(titleOf(".pdf")).toBe("Untitled book");
  expect(titleOf(`${"x".repeat(400)}.pdf`)).toHaveLength(300);
});
