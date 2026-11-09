import { fireEvent, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";

// P4-W21-S03 (§5F, §6.7): topic paths (list, Start, a path's readings and checkpoint) and
// boards (chips, rows, the pinned own row, scopes to set up on the web).
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
const summary = (pathId: string, name: string, mine: string | null) => ({
  pathId,
  name,
  why: `Why ${name}`,
  sections: 6,
  readings: 18,
  minutes: 120,
  mine,
  retired: false,
});
const timeline = {
  pathId: "3",
  name: "Distributed systems",
  why: "Consensus to caching",
  retired: false,
  mine: "active",
  sections: [
    {
      sectionId: "12",
      concepts: ["Raft"],
      open: true,
      checkpoint: "ready",
      skipped: false,
      holdsBack: true,
      mastered: false,
      size: 5,
      passMark: 4,
      readings: [
        {
          itemId: "5",
          momentId: "9",
          sectionTitle: "Leader election",
          articleTitle: "Raft",
          sourceName: "A blog",
          minutes: 6,
          linkBroken: false,
          finished: true,
        },
      ],
    },
    {
      sectionId: "13",
      concepts: ["Paxos"],
      open: false,
      checkpoint: "locked",
      skipped: false,
      holdsBack: false,
      mastered: false,
      size: 5,
      passMark: 4,
      readings: [
        {
          itemId: "6",
          momentId: "10",
          sectionTitle: "Paxos made simple",
          articleTitle: "Paxos",
          sourceName: "A blog",
          minutes: 8,
          linkBroken: false,
          finished: false,
        },
      ],
    },
  ],
};
const board = {
  game: "daily",
  scope: "global",
  period: "current",
  games: [
    { key: "daily", label: "Daily" },
    { key: "sprint", label: "Sprint" },
  ],
  scopes: [
    { key: "global", label: "Global" },
    { key: "country", label: "Country" },
  ],
  periods: [
    { key: "current", label: "Today" },
    { key: "previous", label: "Yesterday" },
  ],
  body: {
    kind: "rows",
    rows: [
      { id: "u2", name: "@grace", score: "350", rank: 1 },
      { id: "u1", name: "@ada", score: "300", rank: 2 },
    ],
    mine: "u1",
    mark: "You",
    unit: "Points in the day's challenge",
    pinned: {
      id: "u1",
      name: "@ada",
      score: "300",
      rank: 2,
      note: "#2 · top 50%",
    },
    missing: "not_yet",
  },
};

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  jest.clearAllMocks();
});

test("Paths lists the active path first and starts another", async () => {
  serve({
    "GET /api/paths": () =>
      Response.json({
        paths: [
          summary("4", "Databases", null),
          summary("3", "Distributed systems", "active"),
        ],
      }),
    "POST /api/paths/4": () => new Response(null, { status: 204 }),
    "GET /api/paths/4": () =>
      Response.json({
        ...timeline,
        pathId: "4",
        name: "Databases",
        why: "Why Databases",
      }),
  });
  await renderRouter("./app", { initialUrl: "/paths" });
  expect(await screen.findByText("Your active path")).toBeOnTheScreen();
  // The active path first.
  const [first] = screen.getAllByText(/^Why /);
  expect(first).toHaveTextContent("Why Distributed systems");
  expect(
    screen.getByRole("button", { name: "Pause Distributed systems" }),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Start Databases" }),
  );
  expect(await screen.findByText("Why Databases")).toBeOnTheScreen();
  expect(calls()).toContainEqual({
    url: "/api/paths/4",
    method: "POST",
    body: { action: "start" },
  });
});

test("a path's reading opens the reader on its path; its checkpoint opens the quiz", async () => {
  serve({
    "GET /api/paths/3": () => Response.json(timeline),
    "POST /api/quiz": () => Response.json({ attemptId: "50" }, { status: 201 }),
    "GET /api/quiz/50": () =>
      Response.json({
        title: "Raft",
        kind: "checkpoint",
        secondsLeft: null,
        question: {
          kind: "choice",
          questionId: "7",
          stem: "What elects a leader?",
          aiDrafted: false,
          options: ["Raft", "TCP"],
        },
      }),
  });
  await renderRouter("./app", { initialUrl: "/paths/3" });
  expect(
    await screen.findByText("Checkpoint · Pass 4 of 5 to unlock Paxos"),
  ).toBeOnTheScreen();
  expect(
    screen.getByText("Checkpoint · Pass 4 of 5 to finish the path"),
  ).toBeOnTheScreen();
  expect(screen.getByText("✓ Leader election")).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Take the checkpoint" }),
  );
  expect(await screen.findByText("What elects a leader?")).toBeOnTheScreen();
  expect(calls()).toContainEqual({
    url: "/api/quiz",
    method: "POST",
    body: { sectionId: "12" },
  });
});

test("a path's reading asks the reader for it as the path's", async () => {
  serve({ "GET /api/paths/3": () => Response.json(timeline) });
  await renderRouter("./app", { initialUrl: "/paths/3" });
  await fireEvent.press(
    await screen.findByRole("link", { name: "Finished: Leader election" }),
  );
  expect(screen).toHavePathname("/read/5");
  expect(calls().map((c) => c.url)).toContain("/api/read/5?moment=9&path=3");
});

test("not onboarded: finish on the web", async () => {
  serve({
    "GET /api/paths": () =>
      Response.json({ setup: "onboarding" }, { status: 409 }),
  });
  await renderRouter("./app", { initialUrl: "/paths" });
  expect(
    await screen.findByText(/Finish setting up on the web/),
  ).toBeOnTheScreen();
});

test("Boards: rows, the player's own marked and pinned; a chip reads that board", async () => {
  serve({
    "GET /api/boards?game=daily&scope=global&period=current": () =>
      Response.json(board),
    "GET /api/boards?game=daily&scope=country&period=current": () =>
      Response.json({
        ...board,
        scope: "country",
        body: { kind: "unset", what: "country" },
      }),
  });
  await renderRouter("./app", { initialUrl: "/boards" });
  expect(await screen.findByText("@ada · You")).toBeOnTheScreen();
  expect(screen.getByText("You: @ada · 300 · #2 · top 50%")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Country" }));
  expect(
    await screen.findByText(
      "Set your country on Profile on the web to see its board.",
    ),
  ).toBeOnTheScreen();
});

test("a locked section lists its readings without opening them, and says what unlocks it", async () => {
  serve({ "GET /api/paths/3": () => Response.json(timeline) });
  await renderRouter("./app", { initialUrl: "/paths/3" });
  expect(
    await screen.findByText("Locked · unlocks after the Raft checkpoint"),
  ).toBeOnTheScreen();
  expect(screen.getByText("Paxos made simple")).toBeOnTheScreen();
  expect(screen.queryByRole("link", { name: "Paxos made simple" })).toBeNull();
});

test("a path not started can be started from its page", async () => {
  let started = false;
  serve({
    "GET /api/paths/3": () =>
      Response.json({ ...timeline, mine: started ? "active" : null }),
    "POST /api/paths/3": () => {
      started = true;
      return new Response(null, { status: 204 });
    },
  });
  await renderRouter("./app", { initialUrl: "/paths/3" });
  expect(
    screen.queryByRole("button", { name: "Take the checkpoint" }),
  ).toBeNull();
  await fireEvent.press(
    await screen.findByRole("button", { name: "Start this path" }),
  );
  expect(
    await screen.findByRole("button", { name: "Take the checkpoint" }),
  ).toBeOnTheScreen();
});

test("a board that fails to load keeps the chips and offers another try", async () => {
  let fail = true;
  serve({
    "GET /api/boards?game=daily&scope=global&period=current": () =>
      Response.json(board),
    "GET /api/boards?game=sprint&scope=global&period=current": () =>
      fail
        ? new Response(null, { status: 500 })
        : Response.json({ ...board, game: "sprint" }),
  });
  await renderRouter("./app", { initialUrl: "/boards" });
  await fireEvent.press(await screen.findByRole("button", { name: "Sprint" }));
  expect(
    await screen.findByText("Couldn't load that board."),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Daily" })).toBeOnTheScreen();
  fail = false;
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("button", { name: "Sprint", selected: true }),
  ).toBeOnTheScreen();
});
