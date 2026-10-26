import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Progress } from "../../server/ports";

// §5D, C-22, Q-P1-35, P1-W5-S02: finishing from the return prompt or Mark done.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const finishMoment = vi.fn<Progress["finishMoment"]>(() =>
  Promise.resolve(true),
);
const finishArticle = vi.fn<Progress["finishArticle"]>(() =>
  Promise.resolve(true),
);
const finishArticleIfComplete = vi.fn<Progress["finishArticleIfComplete"]>(() =>
  Promise.resolve(false),
);
const dismissContinue = vi.fn<Progress["dismissContinue"]>(() =>
  Promise.resolve(),
);
const emit = vi.fn();
const deleteCookie = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  progress: () => ({
    finishMoment,
    finishArticle,
    finishArticleIfComplete,
    dismissContinue,
  }),
  events: () => ({ emit }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
      delete: deleteCookie,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };
const context = { ...guest, sessionId: "visit-1" };

afterEach(() => {
  vi.clearAllMocks();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function finish(fields: Record<string, string>) {
  const { finishAction } = await import("./actions");
  current.mockResolvedValue(guest);
  return finishAction(form(fields));
}

test.each(["return_prompt", "mark_done"] as const)(
  "a section finished by %s is recorded once, then the next is offered",
  async (method) => {
    await expect(
      finish({
        control: "finish",
        itemId: "5",
        momentId: "9",
        method,
        chip: "3-8",
      }),
    ).rejects.toThrow("redirect:/?chip=3-8&finished=5.9");
    expect(finishMoment).toHaveBeenCalledExactlyOnceWith(
      "g1",
      "5",
      "9",
      method,
    );
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "section_finished",
      { method },
      context,
    );
    expect(deleteCookie).toHaveBeenCalledWith("iv_reading");
  },
);

test("a whole article is finished as an article", async () => {
  await expect(
    finish({
      control: "finish",
      itemId: "5",
      method: "mark_done",
      chip: "8-15",
    }),
  ).rejects.toThrow("redirect:/?chip=8-15&finished=5.");
  expect(finishArticle).toHaveBeenCalledExactlyOnceWith("g1", "5", "mark_done");
  expect(finishMoment).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "article_finished",
    { method: "mark_done" },
    context,
  );
});

test("a repeat records nothing new and counts nothing", async () => {
  finishMoment.mockResolvedValueOnce(false);
  await expect(
    finish({
      control: "finish",
      itemId: "5",
      momentId: "9",
      method: "return_prompt",
      chip: "3-8",
    }),
  ).rejects.toThrow("redirect:");
  expect(emit).not.toHaveBeenCalled();
});

test("dismiss clears the panel and records nothing", async () => {
  await expect(
    finish({
      control: "dismiss",
      itemId: "5",
      chip: "3-8",
      method: "mark_done",
    }),
  ).rejects.toThrow(/^redirect:\/\?chip=3-8$/);
  expect(deleteCookie).toHaveBeenCalledWith("iv_reading");
  expect(finishMoment).not.toHaveBeenCalled();
  expect(finishArticle).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test.each([
  [
    "a bad method",
    { control: "finish", itemId: "5", method: "guess", chip: "3-8" },
  ],
  [
    "a bad item",
    { control: "finish", itemId: "x", method: "mark_done", chip: "3-8" },
  ],
  [
    "a bad chip",
    { control: "finish", itemId: "5", method: "mark_done", chip: "9" },
  ],
])("%s is refused without a write", async (_name, fields) => {
  await expect(finish(fields)).rejects.toThrow(/^redirect:\/$/);
  expect(finishMoment).not.toHaveBeenCalled();
  expect(finishArticle).not.toHaveBeenCalled();
});

test("without a session the visitor is sent to /join", async () => {
  const { finishAction } = await import("./actions");
  current.mockResolvedValue(null);
  await expect(
    finishAction(
      form({
        control: "finish",
        itemId: "5",
        method: "mark_done",
        chip: "3-8",
      }),
    ),
  ).rejects.toThrow("redirect:/join");
  expect(finishArticle).not.toHaveBeenCalled();
});

// P1-W5-S03 (Q-P1-35): the finish that completes an article finishes the article.
test("the last section's finish also finishes the article, once", async () => {
  finishArticleIfComplete.mockResolvedValueOnce(true);
  await expect(
    finish({
      control: "finish",
      itemId: "5",
      momentId: "9",
      method: "return_prompt",
      chip: "3-8",
    }),
  ).rejects.toThrow("redirect:");
  expect(finishArticleIfComplete).toHaveBeenCalledWith(
    "g1",
    "5",
    "return_prompt",
  );
  expect(emit.mock.calls.map((c) => c[0] as string)).toEqual([
    "section_finished",
    "article_finished",
  ]);
});

test("a repeated section finish doesn't look at the article", async () => {
  finishMoment.mockResolvedValueOnce(false);
  await expect(
    finish({
      control: "finish",
      itemId: "5",
      momentId: "9",
      method: "mark_done",
      chip: "3-8",
    }),
  ).rejects.toThrow("redirect:");
  expect(finishArticleIfComplete).not.toHaveBeenCalled();
});

test("a continue card can be dismissed", async () => {
  const { continueAction } = await import("./actions");
  current.mockResolvedValue(guest);
  await expect(
    continueAction(form({ itemId: "5", chip: "3-8" })),
  ).rejects.toThrow(/^redirect:\/\?chip=3-8$/);
  expect(dismissContinue).toHaveBeenCalledExactlyOnceWith("g1", "5");
});
