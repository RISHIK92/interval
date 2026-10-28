import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, BookReading, Books } from "../../../server/ports";

// §5F, Q-P2-31 updated (P2-W11-S04): a book's session, read in the app as its own
// PDF pages; the extracted text isn't shown (owner, 2026-10-28).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const reading = vi.fn<Books["reading"]>();
const list = vi.fn<Books["list"]>(() => Promise.resolve([]));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({
    get: () =>
      Promise.resolve({
        goals: [],
        topics: ["backend"],
        level: "beginner",
        breakLength: "3-8",
        firstName: null,
      }),
  }),
  books: () => ({ reading, list }),
  events: () => ({ emit }),
}));
const emit = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const session: BookReading = {
  bookId: "7",
  bookTitle: "Designing Data Systems",
  chapterTitle: "Replication",
  sessionId: "71",
  title: "Leaders",
  minutes: 4,
  firstPage: 41,
  lastPage: 46,
  finished: false,
  fraction: 0.25,
  previous: "70",
  next: "72",
  place: 2,
  of: 9,
};

afterEach(() => {
  vi.clearAllMocks();
});

async function page(query: Record<string, string> = {}, id = "7") {
  current.mockResolvedValue(user);
  const { default: BookPage } = await import("./page");
  return renderToStaticMarkup(
    await BookPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(query),
    }),
  );
}

test("the session's pages with where it is, and no extracted text", async () => {
  reading.mockResolvedValueOnce(session);
  const html = await page({ session: "71" });
  expect(reading).toHaveBeenCalledWith("u1", "7", "71");
  expect(html).toContain("Session 2 of 9 · pages 41–46 · 4 min");
  expect(html).not.toContain("Show the text");
  expect(html).toContain("Replication");
  expect(html).toContain('href="/books/7?session=70"');
  expect(html).toContain('href="/books/7?session=72"');
  expect(html).toMatch(
    /name="sessionId" value="71"[^]*?name="next" value="72"[^]*?Mark done/,
  );
});

test("a finished session isn't offered again; the last has no Next", async () => {
  reading.mockResolvedValueOnce({ ...session, finished: true, next: null });
  const html = await page();
  expect(reading).toHaveBeenCalledWith("u1", "7", null);
  expect(html).not.toContain("Mark done");
  expect(html).not.toContain("Next →");
  expect(html).toContain("· Finished");
});

test("someone else's book is not found; the user's own not ready goes to the list", async () => {
  reading.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("notFound");
  list.mockResolvedValueOnce([
    {
      bookId: "7",
      title: "Mine",
      status: "ocr",
      failure: null,
      createdAt: new Date(),
    },
  ]);
  await expect(page()).rejects.toThrow("redirect:/paths#your-books");
  await expect(page({}, "x")).rejects.toThrow("notFound");
});

// P2-W11-S05 (DB-5): each open of a session, from wherever.
test("opening a session emits book_opened with the ids and the visit", async () => {
  reading.mockResolvedValueOnce(session);
  await page({ session: "71" });
  expect(emit).toHaveBeenCalledWith(
    "book_opened",
    { book_id: "7", session_id: "71" },
    expect.objectContaining({ userId: "u1", sessionId: "visit-1" }),
  );
  emit.mockClear();
  reading.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("notFound");
  expect(emit).not.toHaveBeenCalled();
});
