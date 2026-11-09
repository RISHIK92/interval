import { BookReading, BooksResponse, ChapterEnd } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  BookOutline,
  BookReading as Reading,
  ChapterEnd as End,
  Preferences,
} from "../../../../server/ports";

// P4-W21-S04 (§5F, DB-6): the app's books: the list, a session to read, Mark done, and a
// chapter's checkpoint; the owner's only, accounts that finished onboarding.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const prefs = vi.fn(() =>
  Promise.resolve<Preferences | null>({} as Preferences),
);
const outlines = vi.fn<() => Promise<BookOutline[]>>();
const reading = vi.fn<() => Promise<Reading | null>>();
const checkpoint = vi.fn<() => Promise<End | null>>();
const emit = vi.fn();
const finishBookSession = vi.fn();
const requestCheckpoint = vi.fn(() => Promise.resolve());
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get: prefs }),
  books: () => ({ outlines, reading, checkpoint }),
  events: () => ({ emit }),
  jobQueue: () => ({}),
}));
vi.mock("../../../../server/book-flow", () => ({ finishBookSession }));
vi.mock("../../../../server/books", () => ({ requestCheckpoint }));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://", "interval-platform": "android" };
const session: Reading = {
  bookId: "4",
  bookTitle: "DDIA",
  chapterTitle: "Replication",
  sessionId: "31",
  title: "Leaders and followers",
  minutes: 12,
  firstPage: 151,
  lastPage: 158,
  finished: false,
  fraction: 0.25,
  previous: "30",
  next: "32",
  place: 7,
  of: 40,
};
const end: End = {
  bookId: "4",
  bookTitle: "DDIA",
  chapterId: "8",
  title: "Replication",
  finished: true,
  state: "ready",
  stuck: false,
  failure: null,
  size: 5,
  concepts: ["Leader election"],
  last: null,
  next: { sessionId: "40", title: "Partitioning" },
};
afterEach(() => {
  vi.clearAllMocks();
});
const req = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost:3100${path}`, {
    ...init,
    headers: { ...APP, "content-type": "application/json" },
  });

test("the user's books, as the web lists them", async () => {
  current.mockResolvedValue(account);
  outlines.mockResolvedValue([
    {
      bookId: "4",
      title: "DDIA",
      done: 6,
      of: 40,
      first: "1",
      started: true,
      next: "31",
      chapters: [],
    },
  ]);
  const { GET } = await import("../route");
  const body = BooksResponse.parse(await (await GET(req("/api/books"))).json());
  expect(body.books).toEqual([
    {
      bookId: "4",
      title: "DDIA",
      done: 6,
      of: 40,
      first: "1",
      started: true,
      next: "31",
    },
  ]);
});

test("a session to read, recorded as opened from android; not theirs is 404", async () => {
  current.mockResolvedValue(account);
  reading.mockResolvedValueOnce(session);
  const { GET } = await import("./route");
  const ok = await GET(req("/api/books/4?session=31"), {
    params: Promise.resolve({ id: "4" }),
  });
  expect(BookReading.parse(await ok.json())).toEqual(session);
  expect(reading).toHaveBeenCalledWith("u1", "4", "31");
  expect(emit).toHaveBeenCalledWith(
    "book_opened",
    { book_id: "4", session_id: "31" },
    expect.objectContaining({ source: "android", sessionId: null }),
  );
  reading.mockResolvedValueOnce(null);
  const gone = await GET(req("/api/books/4"), {
    params: Promise.resolve({ id: "4" }),
  });
  expect(gone.status).toBe(404);
});

test("Mark done: through the web's flow; a chapter done is said", async () => {
  current.mockResolvedValue(account);
  finishBookSession.mockResolvedValueOnce({ bookId: "4", chapterDone: "8" });
  reading.mockResolvedValue(session);
  const { POST } = await import("./finish/route");
  const done = await POST(
    req("/api/books/4/finish", {
      method: "POST",
      body: JSON.stringify({ sessionId: "31" }),
    }),
    { params: Promise.resolve({ id: "4" }) },
  );
  expect(await done.json()).toEqual({ chapterDone: "8" });
  // A session of another book: as if it weren't there, and nothing marked done.
  reading.mockResolvedValueOnce(null);
  const other = await POST(
    req("/api/books/4/finish", {
      method: "POST",
      body: JSON.stringify({ sessionId: "31" }),
    }),
    { params: Promise.resolve({ id: "4" }) },
  );
  expect(other.status).toBe(404);
  expect(finishBookSession).toHaveBeenCalledTimes(1);
});

test("a chapter's end: its checkpoint state, and asking for it", async () => {
  current.mockResolvedValue(account);
  checkpoint.mockResolvedValue(end);
  const route = await import("./checkpoint/[chapter]/route");
  const params = { params: Promise.resolve({ id: "4", chapter: "8" }) };
  const body = ChapterEnd.parse(
    await (await route.GET(req("/api/books/4/checkpoint/8"), params)).json(),
  );
  expect(body).toMatchObject({ state: "ready", size: 5, passMark: 4 });
  const asked = await route.POST(
    req("/api/books/4/checkpoint/8", { method: "POST" }),
    { params: Promise.resolve({ id: "4", chapter: "8" }) },
  );
  expect(asked.status).toBe(204);
  expect(requestCheckpoint).toHaveBeenCalledWith(expect.anything(), "u1", "8");
  // Another book's chapter: nothing asked.
  checkpoint.mockResolvedValueOnce({ ...end, bookId: "9" });
  const other = await route.POST(
    req("/api/books/4/checkpoint/8", { method: "POST" }),
    { params: Promise.resolve({ id: "4", chapter: "8" }) },
  );
  expect(other.status).toBe(404);
  expect(requestCheckpoint).toHaveBeenCalledTimes(1);
});

test("guests and accounts not onboarded: refused", async () => {
  const { GET } = await import("./route");
  const params = { params: Promise.resolve({ id: "4" }) };
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await GET(req("/api/books/4"), params)).status).toBe(401);
  current.mockResolvedValue(account);
  prefs.mockResolvedValueOnce(null);
  expect(
    (await GET(req("/api/books/4"), { params: Promise.resolve({ id: "4" }) }))
      .status,
  ).toBe(409);
  // Every book route asks the same of who's asking.
  current.mockResolvedValue({ ...account, isGuest: true });
  const { POST } = await import("./finish/route");
  expect(
    (
      await POST(
        req("/api/books/4/finish", {
          method: "POST",
          body: JSON.stringify({ sessionId: "31" }),
        }),
        { params: Promise.resolve({ id: "4" }) },
      )
    ).status,
  ).toBe(401);
  const chapter = await import("./checkpoint/[chapter]/route");
  expect(
    (
      await chapter.POST(req("/api/books/4/checkpoint/8", { method: "POST" }), {
        params: Promise.resolve({ id: "4", chapter: "8" }),
      })
    ).status,
  ).toBe(401);
  expect(reading).not.toHaveBeenCalled();
  expect(finishBookSession).not.toHaveBeenCalled();
  expect(requestCheckpoint).not.toHaveBeenCalled();
});
