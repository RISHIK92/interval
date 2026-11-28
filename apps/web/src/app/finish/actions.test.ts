import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Progress } from "../../server/ports";

// §5D, C-22, Q-P1-35, P1-W5-S02: completing from the return prompt or Done (ADR-0058:
// an article is the only reading unit).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const finishArticle = vi.fn<Progress["finishArticle"]>(() =>
  Promise.resolve(true),
);
const dismissContinue = vi.fn<Progress["dismissContinue"]>(() =>
  Promise.resolve(),
);
const countExploreFinish = vi.fn<Progress["countExploreFinish"]>(() =>
  Promise.resolve(),
);
const emit = vi.fn();
const deleteCookie = vi.fn();
let readingCookie = "5";
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  progress: () => ({
    finishArticle,
    dismissContinue,
    countExploreFinish,
  }),
  events: () => ({ emit }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit"
          ? { name, value: "visit-1.1790000000" }
          : name === "iv_reading"
            ? { name, value: readingCookie }
            : undefined,
      delete: deleteCookie,
    }),
}));
vi.mock("../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const user: Actor = { userId: "g1", isGuest: false, betaGroup: "student" };
const guest: Actor = { ...user, isGuest: true };
const context = { ...user, sessionId: "visit-1" };

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
  current.mockResolvedValue(user);
  return finishAction(form(fields));
}

test.each(["return_prompt", "mark_done"] as const)(
  "an article completed by %s is recorded once, then Home says so",
  async (method) => {
    await expect(
      finish({ control: "finish", itemId: "5", method }),
    ).rejects.toThrow(/^redirect:\/\?finished=5$/);
    expect(finishArticle).toHaveBeenCalledExactlyOnceWith("g1", "5", method);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "article_completed",
      { method, item_id: "5" },
      context,
    );
    expect(deleteCookie).toHaveBeenCalledWith("iv_reading");
  },
);

// A page from before ADR-0058 may still post its section and chip: both are ignored.
test("an older form's section and chip are ignored", async () => {
  await expect(
    finish({
      control: "finish",
      itemId: "5",
      momentId: "9",
      chip: "8-15",
      method: "mark_done",
    }),
  ).rejects.toThrow(/^redirect:\/\?finished=5$/);
  expect(finishArticle).toHaveBeenCalledExactlyOnceWith("g1", "5", "mark_done");
});

test("a repeat records nothing new and counts nothing", async () => {
  finishArticle.mockResolvedValueOnce(false);
  await expect(
    finish({ control: "finish", itemId: "5", method: "mark_done" }),
  ).rejects.toThrow("redirect:");
  expect(emit).not.toHaveBeenCalled();
  expect(countExploreFinish).not.toHaveBeenCalled();
});

test("a new completion counts toward the item's exploration arm", async () => {
  await expect(
    finish({ control: "finish", itemId: "5", method: "mark_done" }),
  ).rejects.toThrow("redirect:");
  expect(countExploreFinish).toHaveBeenCalledExactlyOnceWith("g1", "5");
});

test("dismiss clears the panel and records nothing", async () => {
  await expect(
    finish({ control: "dismiss", itemId: "5", method: "return_prompt" }),
  ).rejects.toThrow(/^redirect:\/$/);
  expect(deleteCookie).toHaveBeenCalledWith("iv_reading");
  expect(finishArticle).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test.each([
  ["a bad method", { control: "finish", itemId: "5", method: "guess" }],
  ["a bad id", { control: "finish", itemId: "x", method: "mark_done" }],
])("%s goes home and records nothing", async (_, fields) => {
  await expect(finish(fields)).rejects.toThrow(/^redirect:\/$/);
  expect(finishArticle).not.toHaveBeenCalled();
});

test("without a session the visitor is sent to /join", async () => {
  const { finishAction } = await import("./actions");
  current.mockResolvedValue(null);
  await expect(
    finishAction(form({ control: "finish", itemId: "5", method: "mark_done" })),
  ).rejects.toThrow("redirect:/join");
});

test("a continue card can be dismissed", async () => {
  const { continueAction } = await import("./actions");
  current.mockResolvedValue(user);
  await expect(continueAction(form({ itemId: "5" }))).rejects.toThrow(
    /^redirect:\/$/,
  );
  expect(dismissContinue).toHaveBeenCalledWith("g1", "5");
});

// The Library's prompt and a reader opened from it answer back to the Library (owner,
// 2026-10-26); a path off this site is ignored.
test("a finish or dismiss with back returns there, if it is on this site", async () => {
  await expect(
    finish({
      control: "finish",
      itemId: "5",
      method: "mark_done",
      back: "/library",
    }),
  ).rejects.toThrow(/^redirect:\/library$/);
  await expect(
    finish({
      control: "dismiss",
      itemId: "5",
      method: "return_prompt",
      back: "/library",
    }),
  ).rejects.toThrow(/^redirect:\/library$/);
  await expect(
    finish({
      control: "finish",
      itemId: "5",
      method: "mark_done",
      back: "https://evil.test/x",
    }),
  ).rejects.toThrow("redirect:/?finished=5");
});

// Now reading is about what the feed opened (owner, 2026-10-26): a finish from the
// Library leaves it unless it is the same article. A cookie from before ADR-0058
// ("item.moment") names its article.
test("a Library finish keeps Now reading for another article", async () => {
  readingCookie = "77";
  await expect(
    finish({
      control: "finish",
      itemId: "5",
      method: "mark_done",
      back: "/library",
    }),
  ).rejects.toThrow("redirect:/library");
  expect(deleteCookie).not.toHaveBeenCalled();
  readingCookie = "5.9";
  await expect(
    finish({
      control: "dismiss",
      itemId: "5",
      method: "return_prompt",
      back: "/library",
    }),
  ).rejects.toThrow("redirect:/library");
  expect(deleteCookie).toHaveBeenCalledWith("iv_reading");
  readingCookie = "5";
});

// ADR-0029: guests play, and only play; this action is for accounts.
test("a guest is sent to sign up before anything is written", async () => {
  current.mockResolvedValue(guest);
  const all = await import("./actions");
  await expect(all.finishAction(new FormData())).rejects.toThrow(
    "redirect:/sign-up",
  );
  await expect(all.continueAction(new FormData())).rejects.toThrow(
    "redirect:/sign-up",
  );
});
