import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Progress,
  QuizAttempt,
  Quizzes,
} from "../../../../server/ports";

// Test 60s results (P2-W9-S02, wireframe 14 variant test).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const attempt = vi.fn<Quizzes["attempt"]>();
const nextMoment = vi.fn<Progress["nextMoment"]>();
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  quizzes: () => ({ attempt }),
  progress: () => ({ nextMoment }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const started = new Date("2026-10-28T10:00:00Z");
const done: QuizAttempt = {
  review: false,
  sprint: false,
  estimation: null,
  itemId: "5",
  momentId: "9",
  title: "Raft",
  startedAt: started,
  endsAt: new Date(started.getTime() + 60_000),
  secondsLeft: 0,
  finishedAt: new Date(started.getTime() + 41_000),
  answered: 4,
  correct: 3,
  avgMs: 8200,
  concepts: [
    { name: "Leader election", state: "explored" },
    { name: "Raft", state: null },
  ],
  checkpoint: null,
  missed: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

async function render(got: QuizAttempt | null = done) {
  current.mockResolvedValue(user);
  attempt.mockResolvedValue(got);
  const { default: ResultsPage } = await import("./page");
  return renderToStaticMarkup(
    await ResultsPage({
      params: Promise.resolve({ attempt: "41" }),
      searchParams: Promise.resolve({ chip: "3-8" }),
    }),
  );
}

test("the results: correct of answered, accuracy, times and each concept's state", async () => {
  nextMoment.mockResolvedValue({
    momentId: "10",
    title: "Log replication",
    frameable: true,
  });
  const html = await render();
  expect(html).toContain("3 of 4 correct");
  expect(html).toContain("75%");
  expect(html).toContain("8.2s");
  expect(html).toContain("41s");
  expect(html).toContain("Leader election");
  expect(html).toContain("Explored");
  // §3.1's name for a concept with no evidence.
  expect(html).toContain("Unseen");
  // Each stat's term comes before its value (a valid description list).
  expect(html).toMatch(/<dt[^>]*>Accuracy<\/dt><dd[^>]*>75%<\/dd>/);
  // Queued next: the next section, in the reader.
  expect(html).toContain("Log replication");
  expect(html).toContain("/read/5?moment=10&amp;chip=3-8&amp;from=continue");
  expect(html).toContain('href="/?chip=3-8"');
});

test("nothing answered says so; the last section has nothing queued", async () => {
  nextMoment.mockResolvedValue(null);
  const html = await render({
    ...done,
    answered: 0,
    correct: 0,
    avgMs: null,
    concepts: [],
  });
  expect(html).toContain("No answers this time");
  expect(html).not.toContain("Queued next");
});

test("an attempt still running goes back to it; another's goes home", async () => {
  await expect(render({ ...done, finishedAt: null })).rejects.toThrow(
    "redirect:/quiz/41?chip=3-8",
  );
  await expect(render(null)).rejects.toThrow("redirect:/");
});

test("a review's results: no section to continue, time from start to finish", async () => {
  const html = await render({
    ...done,
    review: true,
    itemId: null,
    momentId: null,
    title: "Review",
    endsAt: null,
    secondsLeft: null,
  });
  expect(nextMoment).not.toHaveBeenCalled();
  expect(html).toContain("3 of 4 correct");
  expect(html).toContain(">Review<");
  expect(html).not.toContain("Test yourself");
  expect(html).toContain("41s");
  expect(html).not.toContain("Queued next");
  expect(html).toContain('href="/library"');
  expect(html).toContain("Back to Library");
});

const checkpoint = {
  ...done,
  itemId: null,
  momentId: null,
  title: "Quorums",
  checkpoint: {
    at: { kind: "path" as const, pathId: "6", sectionId: "60" },
    title: "Quorums",
    concepts: ["Quorums"],
    size: 5,
    passMark: 4,
    passed: false,
    next: ["Leases"],
    missed: ["Quorums"],
  },
};

test("a passed checkpoint says what it unlocked and leads back to the path", async () => {
  const html = await render({
    ...checkpoint,
    correct: 4,
    answered: 5,
    checkpoint: { ...checkpoint.checkpoint, passed: true, missed: [] },
  });
  expect(html).not.toContain("review queue");
  expect(nextMoment).not.toHaveBeenCalled();
  expect(html).toContain("Checkpoint · Quorums");
  expect(html).toContain("Passed: Leases unlocked.");
  expect(html).toContain('href="/paths/6"');
  expect(html).not.toContain("Try again");
  // The last section's: the path is done.
  expect(
    await render({
      ...checkpoint,
      checkpoint: { ...checkpoint.checkpoint, passed: true, next: null },
    }),
  ).toContain("That&#x27;s the whole path.");
});

test("a failed checkpoint says what it needs, what's in review, and offers a retry", async () => {
  const html = await render(checkpoint);
  expect(html).toContain("Not yet: 4 of 5 needed.");
  expect(html).toContain("In your review queue now: Quorums.");
  expect(html).toMatch(
    /name="sectionId" value="60"[^]*?name="back" value="\/paths\/6"[^]*?Try again/,
  );
  expect(html).toContain("Back to the path");
});

test("a passed checkpoint still names what it put in review (owner, 2026-10-28)", async () => {
  const html = await render({
    ...checkpoint,
    correct: 4,
    answered: 5,
    checkpoint: { ...checkpoint.checkpoint, passed: true, missed: ["Quorums"] },
  });
  expect(html).toContain("Passed: Leases unlocked.");
  expect(html).toContain("In your review queue now: Quorums.");
});

// P3-W13-S02 (§6.1): a sprint's misses go back to reading, then back to Play.
const sprintDone: QuizAttempt = {
  ...done,
  sprint: true,
  estimation: null,
  itemId: null,
  momentId: null,
  title: "60-second sprint",
  missed: [
    { itemId: "5", momentId: "9", sectionTitle: "Raft", frameable: true },
    { itemId: "6", momentId: "12", sectionTitle: "Paxos", frameable: false },
  ],
};

test("a sprint's results send its misses back to reading, and lead back to Play", async () => {
  const html = await render(sprintDone);
  expect(html).toContain("60-second sprint");
  expect(html).toContain("Read again");
  expect(html).toMatch(/href="\/read\/5\?moment=9[^"]*"[^>]*>Raft</);
  expect(html).toMatch(/href="\/out\?[^"]*"[^>]*target="_blank"[^>]*>Paxos</);
  expect(html).toMatch(/href="\/play"[^>]*>Back to Play</);
  expect(nextMoment).not.toHaveBeenCalled();
});

test("a guest's misses open on the publisher's page: the reader is for accounts", async () => {
  current.mockResolvedValue({ ...user, isGuest: true });
  attempt.mockResolvedValue(sprintDone);
  const { default: ResultsPage } = await import("./page");
  const html = renderToStaticMarkup(
    await ResultsPage({
      params: Promise.resolve({ attempt: "41" }),
      searchParams: Promise.resolve({ chip: "3-8" }),
    }),
  );
  expect(html).not.toContain('href="/read/');
  expect(html).toMatch(/href="\/out\?[^"]*"[^>]*>Raft</);
});

test("a sprint with no misses has nothing to read again", async () => {
  const html = await render({ ...sprintDone, missed: [] });
  expect(html).not.toContain("Read again");
});

// P3-W13-S04 (§6.3, §6.1, C-27): a round's points, each answer against the real one
// with its source, and the sources of answers under half points to read again.
const answer = (
  stem: string,
  guess: number,
  score: number,
  sourceTitle: string,
) => ({
  questionId: stem,
  stem,
  guess,
  answer: 10,
  unit: "ms",
  score,
  source: {
    kind: "page" as const,
    title: sourceTitle,
    url: `https://docs.example.test/${sourceTitle}`,
    citation: "about 10 ms",
  },
});
const roundDone: QuizAttempt = {
  ...sprintDone,
  title: "Estimation",
  answered: 3,
  correct: 1,
  missed: [],
  estimation: {
    points: 160,
    answers: [
      answer("Disk seek?", 11, 1, "Seeks"),
      answer("Packet round trip?", 25, 0.6, "Networks"),
      answer("Context switch?", 900, 0, "Kernels"),
    ],
  },
};

test("a round's results: its points, each answer against the real one, and Back to Play", async () => {
  const html = await render(roundDone);
  const text = html.replace(/<[^>]+>/g, "|");
  expect(html).toMatch(/<h1[^>]*>160 points</);
  expect(text).toContain("Estimation");
  expect(html).not.toContain("1 of 3 correct");
  expect(html).not.toContain("Accuracy");
  for (const stem of ["Disk seek?", "Packet round trip?", "Context switch?"])
    expect(html).toContain(stem);
  expect(text).toMatch(/900\|?\s*ms/);
  expect(text).toMatch(/100 points/);
  expect(html).toMatch(/href="\/play"[^>]*>Back to Play</);
});

test("only answers under half points go back to reading, at their source", async () => {
  const html = await render(roundDone);
  const again = /Read again[^]*$/.exec(html)?.[0] ?? "";
  expect(again).toMatch(
    /href="https:\/\/docs.example.test\/Kernels"[^>]*rel="noopener noreferrer"/,
  );
  expect(again).not.toContain("docs.example.test/Seeks");
  expect(again).not.toContain("docs.example.test/Networks");
  const close = await render({
    ...roundDone,
    estimation: {
      points: 160,
      answers: [answer("Disk seek?", 11, 1, "Seeks")],
    },
  });
  expect(close).not.toContain("Read again");
});

// P3-W13-S03b: a moment's estimate goes back to its section, through the reader as a
// sprint's miss does; one whose link broke shows its points and no link.
const section = (momentId: string, frameable: boolean) => ({
  kind: "section" as const,
  itemId: "5",
  momentId,
  sectionTitle: `Section ${momentId}`,
  frameable,
});

test("a moment's missed estimates go back to their sections, once each", async () => {
  const html = await render({
    ...roundDone,
    estimation: {
      points: 0,
      answers: [
        { ...answer("Lag?", 900, 0, "x"), source: section("9", true) },
        { ...answer("Lag again?", 800, 0, "x"), source: section("9", true) },
        { ...answer("Quorum?", 900, 0.1, "x"), source: section("12", false) },
        { ...answer("Gone?", 900, 0, "x"), source: null },
      ],
    },
  });
  const again = /Read again[^]*$/.exec(html)?.[0] ?? "";
  expect(again.match(/href="\/read\/5\?moment=9[^"]*"/g)).toHaveLength(1);
  expect(again).toMatch(
    /href="\/out\?[^"]*moment=12[^"]*"[^>]*target="_blank"/,
  );
  expect(html).toContain("Gone?");
  // Never the moment's quote (Q-P2-12).
  expect(html).not.toContain("about 10 ms");
});

test("a round with no answers says so", async () => {
  const html = await render({
    ...roundDone,
    answered: 0,
    correct: 0,
    estimation: { points: 0, answers: [] },
  });
  expect(html).toContain("No answers this time");
});
