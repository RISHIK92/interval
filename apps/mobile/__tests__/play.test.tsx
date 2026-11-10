import { act, fireEvent, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { renderRouter } from "expo-router/testing-library";
import { Share } from "react-native";

// P4-W21-S01 (§6.3, Q-P2-14): Play, a game's questions checked by the server (felt as
// well as seen), the results and the daily's share, and Test me from the reader.
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: url.replace("http://localhost:3100", ""),
    method: init.method,
    body:
      typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null,
  }));
const play = {
  games: { sprint: true, estimation: false, daily: true },
  live: { offered: true, sprint: true, fastest_finger: false },
  daily: { today: "open", streak: { days: 3, freezes: 0 } },
};
const choice = {
  title: "60-second sprint",
  kind: "sprint",
  secondsLeft: 40,
  question: {
    kind: "choice",
    questionId: "7",
    stem: "What elects a leader?",
    aiDrafted: true,
    options: ["Raft", "TCP", "DNS"],
  },
};
const estimate = {
  ...choice,
  kind: "estimation",
  question: {
    kind: "estimate",
    questionId: "8",
    stem: "A typical election timeout?",
    aiDrafted: false,
    unit: "ms",
  },
};
const results = {
  kind: "daily",
  title: "Today's challenge",
  answered: 5,
  correct: 3,
  points: 350,
  daily: { shareId: "abc-123", streak: { days: 4, freezes: 0 } },
  missed: [{ itemId: "5", momentId: "9", sectionTitle: "Timeouts" }],
};
type Routes = Record<string, () => Response>;
const serve = (routes: Routes) => {
  fetchMock.mockImplementation((url, init) => {
    const path = url.replace("http://localhost:3100", "");
    const key = `${init.method ?? "GET"} ${path}`;
    const answer = routes[key];
    return Promise.resolve(
      answer === undefined ? new Response(null, { status: 404 }) : answer(),
    );
  });
};

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

test("Play offers the plan's games and today's challenge", async () => {
  serve({ "GET /api/play": () => Response.json(play) });
  await renderRouter("./app", { initialUrl: "/play" });
  expect(await screen.findByText("Streak: 3 days")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Play Sprint" })).toBeOnTheScreen();
  // Estimation and live fastest finger aren't in this plan.
  expect(screen.getAllByText("Not included in your plan.")).toHaveLength(2);
});

test("a sprint starts from Play; a right answer is felt and shown", async () => {
  serve({
    "GET /api/play": () => Response.json(play),
    "POST /api/quiz": () => Response.json({ attemptId: "40" }, { status: 201 }),
    "GET /api/quiz/40": () => Response.json(choice),
    "POST /api/quiz/40/answer": () =>
      Response.json({ kind: "choice", correct: true, correctOption: 0 }),
  });
  await renderRouter("./app", { initialUrl: "/play" });
  await fireEvent.press(
    await screen.findByRole("button", { name: "Play Sprint" }),
  );
  expect(await screen.findByText("What elects a leader?")).toBeOnTheScreen();
  // ADR-0037: a model drafted it.
  expect(screen.getByText("AI-drafted")).toBeOnTheScreen();
  expect(screen.getByLabelText("40 seconds left")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Raft" }));
  expect(await screen.findByText("Right")).toBeOnTheScreen();
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  expect(calls()).toContainEqual({
    url: "/api/quiz",
    method: "POST",
    body: { game: "sprint" },
  });
  expect(calls()).toContainEqual({
    url: "/api/quiz/40/answer",
    method: "POST",
    body: { questionId: "7", chosen: 0 },
  });
});

test("a wrong answer is felt and the right one marked", async () => {
  serve({
    "GET /api/quiz/40": () => Response.json(choice),
    "POST /api/quiz/40/answer": () =>
      Response.json({ kind: "choice", correct: false, correctOption: 0 }),
  });
  await renderRouter("./app", { initialUrl: "/quiz/40" });
  await fireEvent.press(await screen.findByRole("button", { name: "TCP" }));
  expect(await screen.findByText("Wrong")).toBeOnTheScreen();
  expect(screen.getByText("Raft ✓")).toBeOnTheScreen();
  expect(screen.getByText("TCP ✗")).toBeOnTheScreen();
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("error");
});

test("an estimate shows the answer, its points and its source", async () => {
  serve({
    "GET /api/quiz/41": () => Response.json(estimate),
    "POST /api/quiz/41/answer": () =>
      Response.json({
        kind: "estimate",
        answer: 300,
        unit: "ms",
        score: 0.6,
        source: {
          kind: "section",
          itemId: "5",
          momentId: "9",
          sectionTitle: "Timeouts",
        },
      }),
  });
  await renderRouter("./app", { initialUrl: "/quiz/41" });
  await fireEvent.changeText(
    await screen.findByLabelText("Your estimate, in ms"),
    "250",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Guess" }));
  expect(await screen.findByText("300 ms · 60 points")).toBeOnTheScreen();
  expect(screen.getByText("From: Timeouts")).toBeOnTheScreen();
  expect(calls()).toContainEqual({
    url: "/api/quiz/41/answer",
    method: "POST",
    body: { questionId: "8", guess: 250 },
  });
});

test("over: the results, the daily's link shared, sections to read again", async () => {
  const share = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: "sharedAction", activityType: undefined });
  serve({
    "GET /api/quiz/42": () => Response.json({ ...choice, question: null }),
    "POST /api/quiz/42/finish": () => Response.json(results),
    "GET /api/quiz/42/results": () => Response.json(results),
  });
  await renderRouter("./app", { initialUrl: "/quiz/42" });
  expect(await screen.findByText("3 of 5 right")).toBeOnTheScreen();
  expect(screen).toHavePathname("/quiz/42/results");
  expect(screen.getByText("350 points")).toBeOnTheScreen();
  expect(screen.getByText("Streak: 4 days")).toBeOnTheScreen();
  expect(screen.getByText("Timeouts")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Share" }));
  expect(share).toHaveBeenCalledWith({
    message: "http://localhost:3100/daily/abc-123",
    url: "http://localhost:3100/daily/abc-123",
  });
  share.mockRestore();
});

test("time's up: the results", async () => {
  jest.useFakeTimers();
  serve({
    "GET /api/quiz/43": () => Response.json({ ...choice, secondsLeft: 1 }),
    "POST /api/quiz/43/finish": () =>
      Response.json({ ...results, kind: "sprint", daily: null, points: 3 }),
    "GET /api/quiz/43/results": () =>
      Response.json({ ...results, kind: "sprint", daily: null, points: 3 }),
  });
  await renderRouter("./app", { initialUrl: "/quiz/43" });
  await screen.findByText("What elects a leader?");
  await act(async () => {
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
  });
  expect(await screen.findByText("3 of 5 right")).toBeOnTheScreen();
});

test("Test me starts Test 60s on the reader's section", async () => {
  serve({
    "GET /api/read/5?moment=9": () =>
      Response.json({
        url: "https://blog.dev/raft#election",
        inApp: true,
        title: "Raft",
        domain: "blog.dev",
        saved: false,
        reached: "9",
        nextMomentId: null,
        note: null,
        testable: true,
        listen: false,
        measure: null,
      }),
    "POST /api/quiz": () => Response.json({ attemptId: "44" }, { status: 201 }),
    "GET /api/quiz/44": () =>
      Response.json({ ...choice, kind: "test", title: "Raft" }),
  });
  await renderRouter("./app", { initialUrl: "/read/5?moment=9" });
  await fireEvent.press(await screen.findByRole("button", { name: "Test me" }));
  expect(await screen.findByText("What elects a leader?")).toBeOnTheScreen();
  expect(calls()).toContainEqual({
    url: "/api/quiz",
    method: "POST",
    body: { itemId: "5", momentId: "9" },
  });
});

test("results asked for while the quiz runs go back to it, finishing nothing", async () => {
  serve({
    "GET /api/quiz/45/results": () => new Response(null, { status: 409 }),
    "GET /api/quiz/45": () => Response.json(choice),
  });
  await renderRouter("./app", { initialUrl: "/quiz/45/results" });
  expect(await screen.findByText("What elects a leader?")).toBeOnTheScreen();
  expect(calls().filter((c) => c.url.endsWith("/finish"))).toEqual([]);
});

test("an answer after the clock: finished, the results", async () => {
  serve({
    "GET /api/quiz/46": () => Response.json(choice),
    "POST /api/quiz/46/answer": () => new Response(null, { status: 409 }),
    "POST /api/quiz/46/finish": () => Response.json(results),
    "GET /api/quiz/46/results": () => Response.json(results),
  });
  await renderRouter("./app", { initialUrl: "/quiz/46" });
  await fireEvent.press(await screen.findByRole("button", { name: "Raft" }));
  expect(await screen.findByText("3 of 5 right")).toBeOnTheScreen();
});

test("an answer that can't be sent says so and can be tried again", async () => {
  serve({
    "GET /api/quiz/47": () => Response.json(choice),
    "POST /api/quiz/47/answer": () => new Response(null, { status: 500 }),
  });
  await renderRouter("./app", { initialUrl: "/quiz/47" });
  await fireEvent.press(await screen.findByRole("button", { name: "Raft" }));
  expect(
    await screen.findByText("Couldn't send your answer. Try again."),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "TCP" })).toBeEnabled();
});

test("Test me on a section without questions says so", async () => {
  serve({
    "GET /api/read/5?moment=9": () =>
      Response.json({
        url: "https://blog.dev/raft#election",
        inApp: true,
        title: "Raft",
        domain: "blog.dev",
        saved: false,
        reached: "9",
        nextMomentId: null,
        note: null,
        testable: true,
        listen: false,
        measure: null,
      }),
    "POST /api/quiz": () => new Response(null, { status: 404 }),
  });
  await renderRouter("./app", { initialUrl: "/read/5?moment=9" });
  await fireEvent.press(await screen.findByRole("button", { name: "Test me" }));
  expect(
    await screen.findByText("No questions on this section yet."),
  ).toBeOnTheScreen();
});

test("Play offers the live modes the plan includes", async () => {
  serve({ "GET /api/play": () => Response.json(play) });
  await renderRouter("./app", { initialUrl: "/play" });
  expect(
    await screen.findByRole("button", { name: "Play Live sprint" }),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "Play Fastest finger" }),
  ).toBeNull();
});

test("live games not set up yet say Coming later, as the web's Play", async () => {
  serve({
    "GET /api/play": () =>
      Response.json({
        ...play,
        live: { offered: false, sprint: true, fastest_finger: true },
      }),
  });
  await renderRouter("./app", { initialUrl: "/play" });
  expect(await screen.findAllByText("Coming later")).toHaveLength(2);
});
