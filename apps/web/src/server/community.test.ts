import { afterEach, describe, expect, test, vi } from "vitest";
import { remainingToday, submitQuestion, writeOffer } from "./community";
import type { CommunityQuestions, Entitlements, JobQueue } from "./ports";

// Q-P7-05 (owner, 2026-11-27): community questions' rules on fake ports (ADR-0012);
// the SQL is tested in adapters/kysely-community-questions.test.ts.

afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = new Date("2026-11-27T15:00:00Z");
const DAY = new Date("2026-11-27T00:00:00Z");
const context = {
  userId: "u1",
  isGuest: false,
  betaGroup: null,
  sessionId: "v1",
};
const valid = {
  momentId: "9",
  stem: "  What does a Raft leader need to commit an entry? ",
  options: ["Every vote", "A majority", "The longest log", "A lease"],
  correct: "1",
  citation: "an entry is committed once a majority has it",
  idempotencyKey: "key-1",
};

function fakes(
  opts: {
    verified?: boolean;
    used?: number;
    limit?: number | null;
    saved?: Awaited<ReturnType<CommunityQuestions["submit"]>>;
  } = {},
) {
  const community = {
    allowance: vi.fn<CommunityQuestions["allowance"]>(() =>
      Promise.resolve({
        verified: opts.verified ?? true,
        used: opts.used ?? 0,
      }),
    ),
    section: vi.fn<CommunityQuestions["section"]>(() =>
      Promise.resolve({
        momentId: "9",
        title: "Raft",
        articleTitle: "Consensus",
      }),
    ),
    submit: vi.fn<CommunityQuestions["submit"]>(() =>
      Promise.resolve(opts.saved ?? { id: "77", created: true, used: 1 }),
    ),
    drop: vi.fn<CommunityQuestions["drop"]>(() => Promise.resolve()),
  };
  const entitlements = {
    can: vi.fn<Entitlements["can"]>(() => Promise.resolve(true)),
    limit: vi.fn<Entitlements["limit"]>(() =>
      Promise.resolve(opts.limit === undefined ? 3 : opts.limit),
    ),
  };
  const enqueue = vi.fn<JobQueue["enqueue"]>(() => Promise.resolve());
  const queue: JobQueue = { enqueue };
  const events = { emit: vi.fn() };
  return { community, entitlements, queue, enqueue, events };
}

describe("submitQuestion", () => {
  test("saves it, queues its check and records ids and counts, never its text", async () => {
    const deps = fakes();
    expect(await submitQuestion(deps, context, valid, NOW)).toEqual({
      status: "submitted",
      id: "77",
      remaining: 2,
    });
    expect(deps.community.submit).toHaveBeenCalledWith(
      "u1",
      {
        ...valid,
        stem: "What does a Raft leader need to commit an entry?",
        correct: 1,
      },
      { since: DAY, limit: 3 },
    );
    expect(deps.enqueue).toHaveBeenCalledWith(
      "validate_question",
      { question_id: 77, attempt: 0, broken: 0 },
      { idempotencyKey: "validate-77" },
    );
    expect(deps.events.emit).toHaveBeenCalledExactlyOnceWith(
      "question_submitted",
      { question_id: "77", moment_id: "9", limited: true, remaining_today: 2 },
      context,
    );
  });

  test("a retry queues the check again under the same key, records nothing, drops nothing (LOAD-5)", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const deps = fakes({ saved: { id: "77", created: false, used: 3 } });
    expect(await submitQuestion(deps, context, valid, NOW)).toEqual({
      status: "submitted",
      id: "77",
      remaining: 0,
    });
    expect(deps.enqueue).toHaveBeenCalledWith(
      "validate_question",
      { question_id: 77, attempt: 0, broken: 0 },
      { idempotencyKey: "validate-77" },
    );
    expect(deps.events.emit).not.toHaveBeenCalled();
    deps.enqueue.mockRejectedValueOnce(new Error("queue down"));
    await expect(submitQuestion(deps, context, valid, NOW)).rejects.toThrow(
      "queue down",
    );
    expect(deps.community.drop).not.toHaveBeenCalled();
  });

  test("on a plan with no daily limit the event says so", async () => {
    const deps = fakes({ limit: null });
    await submitQuestion(deps, context, valid, NOW);
    expect(deps.events.emit).toHaveBeenCalledWith(
      "question_submitted",
      { question_id: "77", moment_id: "9", limited: false, remaining_today: 0 },
      context,
    );
  });

  test.each([
    [{ stem: "  " }, "Write the question, up to 500 characters."],
    [{ stem: "x".repeat(501) }, "Write the question, up to 500 characters."],
    [
      { options: ["a", "b", "c"] },
      "Fill in all 4 answers, up to 200 characters each.",
    ],
    [
      { options: ["a", "b", "c", " "] },
      "Fill in all 4 answers, up to 200 characters each.",
    ],
    [
      { options: ["A lease", "b", "c", "a  LEASE."] },
      "Make the answers all different.",
    ],
    [{ correct: undefined }, "Choose which answer is correct."],
    [{ correct: "4" }, "Choose which answer is correct."],
    [
      { citation: "a majority" },
      "Quote the section: at least 3 words, up to 300 characters.",
    ],
    [{ momentId: "x" }, "Check the question and try again."],
  ])("%j is refused with a clear message", async (change, message) => {
    const deps = fakes();
    expect(
      await submitQuestion(deps, context, { ...valid, ...change }, NOW),
    ).toEqual({ status: "invalid", message });
    expect(deps.community.submit).not.toHaveBeenCalled();
  });

  test("an unverified email, today's limit or a section not opened is refused", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const unverified = fakes({ verified: false });
    expect(await submitQuestion(unverified, context, valid, NOW)).toEqual({
      status: "refused",
      reason: "unverified",
    });
    expect(unverified.community.submit).not.toHaveBeenCalled();
    for (const reason of ["daily_limit", "no_section"] as const) {
      const deps = fakes({ saved: reason });
      expect(await submitQuestion(deps, context, valid, NOW)).toEqual({
        status: "refused",
        reason,
      });
      expect(deps.enqueue).not.toHaveBeenCalled();
      expect(deps.events.emit).not.toHaveBeenCalled();
    }
  });

  test("a check that can't be queued drops the question and says so", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const deps = fakes();
    deps.enqueue.mockRejectedValueOnce(new Error("queue down"));
    await expect(submitQuestion(deps, context, valid, NOW)).rejects.toThrow(
      "queue down",
    );
    expect(deps.community.drop).toHaveBeenCalledWith("77");
    expect(deps.events.emit).not.toHaveBeenCalled();
  });
});

describe("the end of a section", () => {
  test("offers writing to a verified account and verifying to the rest", async () => {
    const deps = fakes();
    expect(await writeOffer(deps, "u1", "9", NOW)).toBe("write");
    expect(deps.community.section).toHaveBeenCalledWith("u1", "9");
    expect(await writeOffer(fakes({ verified: false }), "u1", "9", NOW)).toBe(
      "verify",
    );
  });

  test("offers nothing without questions.submit or a section to write about", async () => {
    const unplanned = fakes();
    unplanned.entitlements.can.mockResolvedValue(false);
    expect(await writeOffer(unplanned, "u1", "9", NOW)).toBeNull();
    expect(unplanned.entitlements.can).toHaveBeenCalledWith(
      "u1",
      "questions.submit",
    );
    const unopened = fakes();
    unopened.community.section.mockResolvedValue(null);
    expect(await writeOffer(unopened, "u1", "9", NOW)).toBeNull();
  });

  test("today's remaining count, from the UTC day's start", async () => {
    const deps = fakes({ used: 2 });
    expect(await remainingToday(deps, "u1", NOW)).toBe(1);
    expect(deps.community.allowance).toHaveBeenCalledWith("u1", DAY);
    expect(await remainingToday(fakes({ used: 5 }), "u1", NOW)).toBe(0);
    expect(await remainingToday(fakes({ limit: null }), "u1", NOW)).toBeNull();
  });
});
