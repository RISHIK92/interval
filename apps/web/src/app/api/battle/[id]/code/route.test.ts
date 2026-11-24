import { afterEach, expect, test, vi } from "vitest";
import type { Actor, BattleCode } from "../../../../../server/ports";

// Q-WD-17 (owner, 2026-11-23): the battle page's autosave, one file per language.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const save = vi.fn<BattleCode["save"]>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
vi.mock("../../../../../server/container", () => ({
  entitlements: () => ({ can }),
  sessionReader: () => ({ current }),
  battleCode: () => ({ save }),
}));
vi.mock("../../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

const MATCH = "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b";
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function post(
  body: unknown,
  { id = MATCH, origin = "http://localhost:3100" } = {},
): Promise<Response> {
  const { POST } = await import("./route");
  return POST(
    new Request(`http://localhost:3100/api/battle/${id}/code`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

test("a player's code in a language is saved", async () => {
  current.mockResolvedValue(ada);
  save.mockResolvedValue(true);
  const res = await post({ language: "python", code: "class Cache: ..." });
  expect(res.status).toBe(204);
  expect(save).toHaveBeenCalledWith(
    MATCH,
    "u1",
    "python",
    "class Cache: ...",
    expect.any(Date),
  );
});

test("not a seated player of an open battle: nothing saved", async () => {
  current.mockResolvedValue(ada);
  save.mockResolvedValue(false);
  expect((await post({ language: "go", code: "x" })).status).toBe(409);
});

test("another site, no session, no capability, or a bad or large body is refused before saving", async () => {
  current.mockResolvedValue(ada);
  expect(
    (
      await post(
        { language: "go", code: "x" },
        { origin: "https://evil.example" },
      )
    ).status,
  ).toBe(403);
  expect((await post({ language: "cobol", code: "x" })).status).toBe(400);
  expect(
    (await post({ language: "go", code: "x" }, { id: "nope" })).status,
  ).toBe(400);
  // 256 KB of code, counted in bytes: the column's cap.
  expect(
    (await post({ language: "go", code: "é".repeat(128 * 1024 + 1) })).status,
  ).toBe(413);
  expect(
    (await post({ language: "go", code: "x".repeat(300 * 1024) })).status,
  ).toBe(413);
  current.mockResolvedValue(null);
  expect((await post({ language: "go", code: "x" })).status).toBe(401);
  current.mockResolvedValue(ada);
  can.mockResolvedValueOnce(false);
  expect((await post({ language: "go", code: "x" })).status).toBe(403);
  expect(save).not.toHaveBeenCalled();
});

test("a store failure is an error, not a silent loss", async () => {
  current.mockResolvedValue(ada);
  save.mockRejectedValueOnce(new Error("db down"));
  await expect(post({ language: "go", code: "x" })).rejects.toThrow("db down");
});

test("a body with no length, streamed past the cap, is refused as it's read", async () => {
  current.mockResolvedValue(ada);
  const { POST } = await import("./route");
  const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ < 10) controller.enqueue(chunk);
      else controller.close();
    },
  });
  const res = await POST(
    new Request(`http://localhost:3100/api/battle/${MATCH}/code`, {
      method: "POST",
      headers: { origin: "http://localhost:3100" },
      body,
      duplex: "half",
    } as RequestInit),
    { params: Promise.resolve({ id: MATCH }) },
  );
  expect(res.status).toBe(413);
  // Not all of it was read.
  expect(sent).toBeLessThan(10);
  expect(save).not.toHaveBeenCalled();
});
