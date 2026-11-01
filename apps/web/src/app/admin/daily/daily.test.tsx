import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, AdminDaily, DailySet } from "../../../server/ports";

// P3-W13-S05 (ADR-0031): tomorrow's daily challenge, for admin.review only.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const sets = vi.fn<AdminDaily["sets"]>();
const approve = vi.fn<AdminDaily["approve"]>(() => Promise.resolve(true));
const swap = vi.fn<AdminDaily["swap"]>(() => Promise.resolve(true));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminDaily: () => ({ sets, approve, swap }),
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
const set = (day: string, extra: Partial<DailySet> = {}): DailySet => ({
  day,
  approved: false,
  publishedUnreviewed: false,
  questions: [
    {
      position: 0,
      questionId: "11",
      kind: "choice",
      stem: "What does a quorum need?",
      status: "live",
      concepts: ["Quorum"],
      source: "Consensus",
    },
    {
      position: 1,
      questionId: "12",
      kind: "estimate",
      stem: "How long is a disk seek?",
      status: "retired",
      concepts: ["Disks"],
      source: "Latency numbers",
    },
  ],
  ...extra,
});

afterEach(() => {
  vi.clearAllMocks();
});

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: DailyPage } = await import("./page");
  return renderToStaticMarkup(
    await DailyPage({ searchParams: Promise.resolve(query) }),
  );
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

test("only admin.review sees the page or uses its actions", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  const { approveDailyAction, swapDailyAction } = await import("./actions");
  await expect(approveDailyAction(form({ day: "2031-03-11" }))).rejects.toThrow(
    "notFound",
  );
  await expect(
    swapDailyAction(form({ day: "2031-03-11", position: "0" })),
  ).rejects.toThrow("notFound");
  expect(approve).not.toHaveBeenCalled();
  expect(swap).not.toHaveBeenCalled();
});

test("tomorrow's set with a swap for each question and Approve; today's without", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  sets.mockResolvedValue({
    today: set("2031-03-10", { approved: true }),
    tomorrow: set("2031-03-11"),
  });
  const html = await page();
  const [tomorrow = "", today = ""] = html.split(">Today<");
  expect(tomorrow).toContain(
    "2031-03-11 · 2 of 5 questions · not approved yet",
  );
  expect(tomorrow).toContain("What does a quorum need?");
  expect(tomorrow).toContain("(retired: skipped)");
  expect(tomorrow.match(/>Swap</g)).toHaveLength(2);
  expect(tomorrow).toMatch(/name="position" value="1"/);
  expect(tomorrow).toContain("Approve tomorrow&#x27;s set");
  expect(today).toContain("2031-03-10 · approved");
  expect(today).not.toContain(">Swap<");
  expect(html).not.toContain("went out without your review");
});

test("a set that went out unreviewed says so and links the review queue", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  sets.mockResolvedValue({
    today: set("2031-03-10", { publishedUnreviewed: true }),
    tomorrow: null,
  });
  const html = await page();
  expect(html).toMatch(
    /role="alert"[^>]*>Today&#x27;s set went out without your review[^]*href="\/admin\/questions"/,
  );
  expect(html).toContain("Not picked yet");
});

test("approve and swap report back; a started day or no fit says why", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { approveDailyAction, swapDailyAction } = await import("./actions");
  await expect(approveDailyAction(form({ day: "2031-03-11" }))).rejects.toThrow(
    "redirect:/admin/daily?saved=approved",
  );
  expect(approve).toHaveBeenCalledWith("2031-03-11");
  approve.mockResolvedValueOnce(false);
  await expect(approveDailyAction(form({ day: "2031-03-11" }))).rejects.toThrow(
    "redirect:/admin/daily?error=started",
  );
  await expect(
    swapDailyAction(form({ day: "2031-03-11", position: "4" })),
  ).rejects.toThrow("redirect:/admin/daily?saved=swapped");
  expect(swap).toHaveBeenCalledWith("2031-03-11", 4);
  swap.mockResolvedValueOnce(false);
  await expect(
    swapDailyAction(form({ day: "2031-03-11", position: "0" })),
  ).rejects.toThrow("redirect:/admin/daily?error=swap");
  for (const bad of [
    { day: "tomorrow", position: "0" },
    { day: "2031-02-30", position: "0" },
    { day: "2031-03-11", position: "5" },
    { day: "2031-03-11", position: "x" },
  ])
    await expect(swapDailyAction(form(bad))).rejects.toThrow("notFound");
  const saved = await page({ saved: "swapped" });
  expect(saved).toMatch(/role="status"[^>]*>Swapped\./);
  sets.mockResolvedValue({ today: null, tomorrow: null });
  expect(await page({ error: "constructor" })).not.toContain('role="alert"');
});
