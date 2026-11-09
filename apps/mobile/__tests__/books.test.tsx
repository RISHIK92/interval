import { act, fireEvent, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import ReactNativeBlobUtil from "react-native-blob-util";
import { discardBooks } from "../lib/books";

// P4-W21-S04 (§5F, DB-6): a book in the app: Your books, a session's pages from the
// private file (fetched for this open, deleted on close), Mark done, the chapter's end.
const blob = ReactNativeBlobUtil as unknown as {
  config: jest.Mock;
  fetchMock: jest.Mock;
  fs: { unlink: jest.Mock; ls: jest.Mock };
};
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: url.replace("http://localhost:3100", ""),
    method: init.method,
    body:
      typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null,
  }));
type Routes = Record<string, () => Response>;
const serve = (routes: Routes) => {
  fetchMock.mockImplementation((url, init) => {
    const key = `${init.method ?? "GET"} ${url.replace("http://localhost:3100", "")}`;
    const answer = routes[key];
    return Promise.resolve(
      answer === undefined ? new Response(null, { status: 404 }) : answer(),
    );
  });
};
const session = {
  bookId: "4",
  bookTitle: "DDIA",
  chapterTitle: "Replication",
  sessionId: "31",
  title: "Leaders and followers",
  minutes: 12,
  firstPage: 151,
  lastPage: 159,
  finished: false,
  fraction: null,
  previous: null,
  next: "32",
  place: 7,
  of: 40,
};
const end = {
  bookId: "4",
  bookTitle: "DDIA",
  chapterId: "8",
  title: "Replication",
  finished: true,
  state: "ready",
  stuck: false,
  failure: null,
  size: 5,
  passMark: 4,
  concepts: ["Leader election"],
  last: null,
  next: null,
};
const pdf = () =>
  screen.getByTestId("book-pdf").props as {
    source: { uri: string };
    page: number;
    onPageChanged: (page: number, total: number) => void;
  };

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

test("Your books on Paths opens the next session", async () => {
  serve({
    "GET /api/paths": () => Response.json({ paths: [] }),
    "GET /api/books": () =>
      Response.json({
        books: [
          {
            bookId: "4",
            title: "DDIA",
            done: 6,
            of: 40,
            first: "1",
            started: true,
            next: "31",
          },
        ],
      }),
    "GET /api/books/4?session=31": () => Response.json(session),
  });
  await renderRouter("./app", { initialUrl: "/paths" });
  expect(await screen.findByText("6 of 40 sessions done")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Resume DDIA" }));
  expect(
    await screen.findByText("Session 7 of 40 · pages 151–159 · 12 min"),
  ).toBeOnTheScreen();
});

test("the session's pages from the private file, fetched for this open and deleted on close", async () => {
  serve({ "GET /api/books/4?session=31": () => Response.json(session) });
  const { unmount } = await renderRouter("./app", {
    initialUrl: "/books/4?session=31",
  });
  await screen.findByText("Replication");
  expect(await screen.findByTestId("book-pdf")).toBeOnTheScreen();
  expect(pdf().page).toBe(151);
  expect(pdf().source.uri).toMatch(/^file:\/\/\/cache\/book-4-\d+\.pdf$/);
  expect(blob.fetchMock).toHaveBeenCalledWith(
    "GET",
    "http://localhost:3100/api/books/4/file",
    expect.objectContaining({ cookie: expect.any(String) as string }),
  );
  const saved = pdf().source.uri.replace("file://", "");
  await unmount();
  expect(blob.fs.unlink).toHaveBeenCalledWith(saved);
});

test("opening a session keeps the place; turning pages within it saves it once they settle", async () => {
  jest.useFakeTimers();
  serve({
    "GET /api/books/4?session=31": () => Response.json(session),
    "POST /api/books/4/position": () => new Response(null, { status: 204 }),
  });
  await renderRouter("./app", { initialUrl: "/books/4?session=31" });
  await screen.findByTestId("book-pdf");
  const turn = async (page: number) => {
    await act(async () => {
      pdf().onPageChanged(page, 600);
      await Promise.resolve();
    });
  };
  // The view opening (page 1, then its jump to the session) moves nothing.
  await turn(1);
  await turn(151);
  await act(async () => {
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
  });
  expect(calls().filter((c) => c.url.endsWith("/position"))).toEqual([]);
  // The reader's own turns: saved a second after they stop, the last one only.
  await turn(153);
  await turn(155);
  await act(async () => {
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
  });
  expect(calls().filter((c) => c.url.endsWith("/position"))).toEqual([
    {
      url: "/api/books/4/position",
      method: "POST",
      body: { sessionId: "31", fraction: 0.5 },
    },
  ]);
  // Past the session: said, and not kept.
  await turn(170);
  expect(
    screen.getByText("Past this session: Mark done, or Next for the next one."),
  ).toBeOnTheScreen();
  await act(async () => {
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
  });
  expect(calls().filter((c) => c.url.endsWith("/position"))).toHaveLength(1);
});

test("a session left off part way opens where it was", async () => {
  serve({
    "GET /api/books/4?session=31": () =>
      Response.json({ ...session, fraction: 0.75 }),
  });
  await renderRouter("./app", { initialUrl: "/books/4?session=31" });
  expect((await screen.findByTestId("book-pdf")).props).toMatchObject({
    page: 157,
  });
});

test("a file that can't be fetched is said, and what was written is removed", async () => {
  serve({ "GET /api/books/4?session=31": () => Response.json(session) });
  blob.fetchMock.mockImplementationOnce(() =>
    Object.assign(Promise.resolve({ info: () => ({ status: 404 }) }), {
      cancel: () => Promise.resolve(),
    }),
  );
  await renderRouter("./app", { initialUrl: "/books/4?session=31" });
  expect(
    await screen.findByText("Couldn't load the book's file."),
  ).toBeOnTheScreen();
  expect(blob.fs.unlink).toHaveBeenCalledWith(
    expect.stringMatching(/^\/cache\/book-4-\d+\.pdf$/),
  );
});

test("Mark done goes to the next session, or to the chapter's end", async () => {
  let chapterDone: string | null = null;
  serve({
    "GET /api/books/4?session=31": () => Response.json(session),
    "GET /api/books/4?session=32": () =>
      Response.json({ ...session, sessionId: "32", place: 8, previous: "31" }),
    "POST /api/books/4/finish": () => Response.json({ chapterDone }),
    "GET /api/books/4/checkpoint/8": () => Response.json(end),
  });
  await renderRouter("./app", { initialUrl: "/books/4?session=31" });
  await fireEvent.press(
    await screen.findByRole("button", { name: "Mark done" }),
  );
  expect(
    await screen.findByText("Session 8 of 40 · pages 151–159 · 12 min"),
  ).toBeOnTheScreen();
  chapterDone = "8";
  await fireEvent.press(screen.getByRole("button", { name: "Mark done" }));
  expect(await screen.findByText("End of chapter")).toBeOnTheScreen();
  expect(screen).toHavePathname("/books/4/checkpoint/8");
});

test("the chapter's end: made from its text, preparing, then taken in the quiz", async () => {
  jest.useFakeTimers();
  let state = "none";
  serve({
    "GET /api/books/4/checkpoint/8": () => Response.json({ ...end, state }),
    "POST /api/books/4/checkpoint/8": () => {
      state = "preparing";
      return new Response(null, { status: 204 });
    },
    "POST /api/quiz": () => Response.json({ attemptId: "60" }, { status: 201 }),
    "GET /api/quiz/60": () =>
      Response.json({
        title: "Replication",
        kind: "checkpoint",
        secondsLeft: 60,
        question: {
          kind: "choice",
          questionId: "7",
          stem: "Who takes writes?",
          aiDrafted: true,
          options: ["The leader", "Any follower"],
        },
      }),
  });
  await renderRouter("./app", { initialUrl: "/books/4/checkpoint/8" });
  await fireEvent.press(
    await screen.findByRole("button", { name: "Make the checkpoint" }),
  );
  expect(
    await screen.findByText("Preparing your checkpoint…"),
  ).toBeOnTheScreen();
  state = "ready";
  await act(async () => {
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
  });
  expect(
    await screen.findByText("60 seconds · 5 questions · pass 4 of 5"),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Take the checkpoint" }),
  );
  expect(await screen.findByText("Who takes writes?")).toBeOnTheScreen();
  expect(calls()).toContainEqual({
    url: "/api/quiz",
    method: "POST",
    body: { chapterId: "8" },
  });
});

test("book files a killed app left are cleared, and nothing else", async () => {
  blob.fs.ls.mockResolvedValueOnce([
    "book-4-17.pdf",
    "image.png",
    "book-notes.txt",
  ]);
  await discardBooks();
  expect(blob.fs.unlink).toHaveBeenCalledTimes(1);
  expect(blob.fs.unlink).toHaveBeenCalledWith("/cache/book-4-17.pdf");
});
