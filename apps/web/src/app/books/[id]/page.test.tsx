import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, BookReading, Books } from "../../../server/ports";

// §5F, Q-P2-31 updated (P2-W11-S04): a book's session, read in the app as its own
// PDF pages, with its text beside them.
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
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
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
  text: "One node takes writes.\n\nThe others <b>copy</b> them.",
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

test("the session's text as paragraphs, never markup, with where it is", async () => {
  reading.mockResolvedValueOnce(session);
  const html = await page({ session: "71" });
  expect(reading).toHaveBeenCalledWith("u1", "7", "71");
  expect(html).toContain("<p>One node takes writes.</p>");
  expect(html).toContain("<p>The others &lt;b&gt;copy&lt;/b&gt; them.</p>");
  expect(html).toContain("Session 2 of 9 · pages 41–46 · 4 min");
  expect(html).toContain("Show the text");
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

test("the heading that opens a session's text isn't shown twice", async () => {
  reading.mockResolvedValueOnce({
    ...session,
    text: "Leaders\n\nOne node takes writes.",
  });
  const html = await page();
  expect(html).not.toContain("<p>Leaders</p>");
  expect(html).toContain("<p>One node takes writes.</p>");
});
