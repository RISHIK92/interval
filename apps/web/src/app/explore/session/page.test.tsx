import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Actor, Asks } from "../../../server/ports";

// An Ask answer's reading session (ADR-0046; owner, 2026-11-26; ADR-0058).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const sessionArticles = vi.fn<Asks["sessionArticles"]>();
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
        firstName: "Ada",
      }),
  }),
  asks: () => ({ sessionArticles }),
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

test("prerequisites first, the top three articles, their total shown", async () => {
  const article = (
    itemId: string,
    title: string,
    minutes: number | null,
    conceptIds: string[] = [],
  ) => ({ itemId, title, sourceName: "DDIA", minutes, conceptIds });
  sessionArticles.mockResolvedValueOnce({
    articles: [
      article("5", "Sharding", 2, ["shard"]),
      article("6", "Replication", 1, ["repl"]),
      article("7", "Long read", 25),
      article("8", "Fourth", 3),
      article("9", "No length", null),
    ],
    prerequisites: [["repl", "shard"]],
  });
  const html = await page();
  expect(sessionArticles).toHaveBeenCalledWith(ID, "u1");
  // ADR-0058: whole articles, no longer cut to 4 minutes.
  expect(text(html)).toContain("A reading session · 28 min");
  expect(text(html).indexOf("Replication")).toBeLessThan(
    text(html).indexOf("Sharding"),
  );
  expect(text(html)).toContain("Long read");
  expect(text(html)).not.toContain("Fourth");
  expect(html).toContain(
    'href="/out?item=6&amp;from=explore&amp;target=article"',
  );
  expect(emit).toHaveBeenCalledWith(
    "ask_session_started",
    { article_count: 3, minutes: 28 },
    expect.objectContaining({ userId: "u1" }),
  );
});

test("another's question, no answer, a bad id or no capability is not found", async () => {
  sessionArticles.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("not-found");
  await expect(page("nope")).rejects.toThrow("not-found");
  can.mockResolvedValueOnce(false);
  await expect(page()).rejects.toThrow("not-found");
  current.mockResolvedValueOnce({ ...ada, isGuest: true });
  await expect(page()).rejects.toThrow("redirect:/sign-up");
  expect(emit).not.toHaveBeenCalled();
});

test("nothing left to open says so and counts nothing", async () => {
  sessionArticles.mockResolvedValueOnce({ articles: [], prerequisites: [] });
  expect(text(await page())).toContain("Nothing to read here");
  expect(emit).not.toHaveBeenCalled();
});
