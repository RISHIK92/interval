import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  AdminQuestions,
  ReviewQuestion,
} from "../../../server/ports";

// Q-2, P2-W8-S03: the spot-check page and its actions exist only for admin.review.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const open = vi.fn<AdminQuestions["open"]>(() => Promise.resolve([]));
const decide = vi.fn<AdminQuestions["decide"]>(() => Promise.resolve(true));
const writeEstimate = vi.fn<AdminQuestions["writeEstimate"]>(() =>
  Promise.resolve("77"),
);
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminQuestions: () => ({ open, decide, writeEstimate }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const admin: Actor = { userId: "a1", isGuest: false, betaGroup: "developer" };

afterEach(() => {
  vi.clearAllMocks();
});

const question: ReviewQuestion = {
  questionId: "42",
  reason: "flagged",
  kind: "choice",
  stem: "What does a candidate need?",
  options: ["Every vote", "A majority", "The longest log", "A lease"],
  correct: 1,
  validatorAnswer: 1,
  citation: "A candidate needs votes from a majority.",
  articleTitle: "Consensus in practice",
  sectionTitle: "Raft",
  link: "https://pub.test/post#raft",
};

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: QuestionsPage } = await import("./page");
  return renderToStaticMarkup(
    await QuestionsPage({ searchParams: Promise.resolve(query) }),
  );
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("only admin.review holders see the page or can decide", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  const { decideAction } = await import("./actions");
  await expect(
    decideAction(form({ questionId: "42", decision: "keep" })),
  ).rejects.toThrow("notFound");
  expect(decide).not.toHaveBeenCalled();
});

test("the queue shows each question with its key, the validator's answer, its quote and a link", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  open.mockResolvedValueOnce([question]);
  const html = await page();
  expect(html).toContain("What does a candidate need?");
  expect(html).toContain("Flagged");
  expect(html).toMatch(/A majority[^<]*<\/li>/);
  expect(html).toContain("key");
  expect(html).toContain("validator");
  expect(html).toContain("A candidate needs votes from a majority.");
  expect(html).toContain('href="https://pub.test/post#raft"');
  expect(html).toMatch(/<button[^>]*value="keep"/);
  expect(html).toMatch(/<button[^>]*value="retire"/);
  // Each reason says why it's here (Q-3, P2-W9-S08: answers looked unusual).
  open.mockResolvedValueOnce([
    { ...question, reason: "sample" },
    { ...question, questionId: "43", reason: "anomaly" },
  ]);
  const reasons = await page();
  expect(reasons).toContain("Weekly sample");
  expect(reasons).toContain("Unusual answers");
  open.mockResolvedValueOnce([]);
  expect(await page()).toContain("Nothing to check");
});

test("Keep or Retire decides the review and says so; bad input changes nothing", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { decideAction } = await import("./actions");
  await expect(
    decideAction(form({ questionId: "42", decision: "retire" })),
  ).rejects.toThrow("redirect:/admin/questions?saved=1");
  expect(decide).toHaveBeenCalledWith("42", "retire", "a1");
  decide.mockResolvedValueOnce(false);
  await expect(
    decideAction(form({ questionId: "42", decision: "keep" })),
  ).rejects.toThrow("redirect:/admin/questions?error=decided");
  vi.clearAllMocks();
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  await expect(
    decideAction(form({ questionId: "x", decision: "keep" })),
  ).rejects.toThrow("notFound");
  await expect(
    decideAction(form({ questionId: "42", decision: "maybe" })),
  ).rejects.toThrow("notFound");
  expect(decide).not.toHaveBeenCalled();
});

// P3-W13-S03 (Q-P3-05 (b)): the owner writes estimation questions here, citing the
// page that states the number (AI-3); they're spot-checked like any other.
const estimateFields = {
  stem: "How many writes per second can one Postgres box take?",
  answer: "10000",
  unit: "writes per second",
  concepts: "write-throughput, wal",
  difficulty: "intermediate",
  sourceUrl: "https://docs.example.test/limits",
  sourceTitle: "Postgres limits",
  citation: "A single box takes about ten thousand writes per second.",
};

test("the page has the estimate form; an estimate in the queue shows its answer and source", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  open.mockResolvedValueOnce([
    {
      questionId: "77",
      reason: "sample",
      kind: "estimate",
      stem: "How many writes per second?",
      answer: 10_000,
      unit: "writes per second",
      citation: "About ten thousand writes per second.",
      articleTitle: "Postgres limits",
      sectionTitle: null,
      link: "https://docs.example.test/limits",
    },
  ]);
  const html = await page({ written: "1" });
  expect(html).toContain("Write an estimation question");
  for (const name of Object.keys(estimateFields))
    expect(html).toContain(`name="${name}"`);
  expect(html).toContain("Estimation question saved");
  expect(html).toContain("Answer: 10,000 writes per second");
  expect(html).toContain("About ten thousand writes per second.");
  expect(html).toContain('href="https://docs.example.test/limits"');
  expect(html).toContain(">Postgres limits<");
  expect(html).not.toContain("<ol");
});

test("writing an estimate saves it live; bad input or an unknown concept saves nothing", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { writeEstimateAction } = await import("./actions");
  await expect(writeEstimateAction(form(estimateFields))).rejects.toThrow(
    "redirect:/admin/questions?written=1",
  );
  expect(writeEstimate).toHaveBeenCalledWith({
    stem: estimateFields.stem,
    answer: 10_000,
    unit: "writes per second",
    concepts: ["write-throughput", "wal"],
    difficulty: "intermediate",
    sourceUrl: "https://docs.example.test/limits",
    sourceTitle: "Postgres limits",
    citation: estimateFields.citation,
  });
  writeEstimate.mockResolvedValueOnce(null);
  await expect(writeEstimateAction(form(estimateFields))).rejects.toThrow(
    "redirect:/admin/questions?error=concepts",
  );
  vi.clearAllMocks();
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  for (const bad of [
    { answer: "0" },
    { answer: "-5" },
    { answer: "ten" },
    { answer: "" },
    { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "ftp://docs.example.test/x" },
    { citation: " " },
    { concepts: " , " },
    { difficulty: "expert" },
    { unit: "" },
  ])
    await expect(
      writeEstimateAction(form({ ...estimateFields, ...bad })),
    ).rejects.toThrow("redirect:/admin/questions?error=estimate");
  expect(writeEstimate).not.toHaveBeenCalled();
});

test("only admin.review holders can write an estimate", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  const { writeEstimateAction } = await import("./actions");
  await expect(writeEstimateAction(form(estimateFields))).rejects.toThrow(
    "notFound",
  );
  expect(writeEstimate).not.toHaveBeenCalled();
});
