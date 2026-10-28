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
    pathId: "6",
    sectionId: "60",
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
