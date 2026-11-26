import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Actor, Asks } from "../../../server/ports";

// "Make it a 4-min session" (ADR-0046; owner, 2026-11-26).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const sessionMoments = vi.fn<Asks["sessionMoments"]>();
const emit = vi.fn();
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  preferences: () => ({
    get: () =>
      Promise.resolve({
        goals: ["stay-sharp"],
        topics: ["databases"],
        level: "beginner",
        breakLength: "3-8",
        firstName: "Ada",
      }),
  }),
  asks: () => ({ sessionMoments }),
  events: () => ({ emit }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));

const ID = "11111111-1111-4111-8111-111111111111";
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: null };

beforeEach(() => {
  current.mockResolvedValue(ada);
  can.mockResolvedValue(true);
});
afterEach(() => {
  vi.clearAllMocks();
});

async function page(question = ID): Promise<string> {
  const { default: SessionPage } = await import("./page");
  return renderToStaticMarkup(
    await SessionPage({ searchParams: Promise.resolve({ question }) }),
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, "");

test("prerequisites first, cut to about 4 minutes, the real total shown", async () => {
  sessionMoments.mockResolvedValueOnce({
    moments: [
      {
        itemId: "5",
        momentId: "1",
        title: "Sharding",
        sourceName: "DDIA",
        minutes: 2,
        conceptIds: ["shard"],
      },
      {
        itemId: "5",
        momentId: "2",
        title: "Replication",
        sourceName: "DDIA",
        minutes: 1,
        conceptIds: ["repl"],
      },
      {
        itemId: "6",
        momentId: "3",
        title: "Long read",
        sourceName: "Blog",
        minutes: 5,
        conceptIds: [],
      },
    ],
    prerequisites: [["repl", "shard"]],
  });
  const html = await page();
  expect(sessionMoments).toHaveBeenCalledWith(ID, "u1");
  expect(text(html)).toContain("A 4-min session · 3 min");
  expect(text(html).indexOf("Replication")).toBeLessThan(
    text(html).indexOf("Sharding"),
  );
  expect(text(html)).not.toContain("Long read");
  expect(html).toContain(
    'href="/out?item=5&amp;moment=2&amp;from=explore&amp;target=section"',
  );
  expect(emit).toHaveBeenCalledWith(
    "ask_session_started",
    { moment_count: 2, minutes: 3 },
    expect.objectContaining({ userId: "u1" }),
  );
});

test("another's question, no answer, a bad id or no capability is not found", async () => {
  sessionMoments.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("not-found");
  await expect(page("nope")).rejects.toThrow("not-found");
  can.mockResolvedValueOnce(false);
  await expect(page()).rejects.toThrow("not-found");
  current.mockResolvedValueOnce({ ...ada, isGuest: true });
  await expect(page()).rejects.toThrow("redirect:/sign-up");
  expect(emit).not.toHaveBeenCalled();
});

test("nothing left to open says so and counts nothing", async () => {
  sessionMoments.mockResolvedValueOnce({ moments: [], prerequisites: [] });
  expect(text(await page())).toContain("Nothing to read here");
  expect(emit).not.toHaveBeenCalled();
});
