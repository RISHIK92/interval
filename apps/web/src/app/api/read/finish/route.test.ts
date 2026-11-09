import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../../server/ports";

// P4-W20-S02 (§5D): the app's Mark done, finishing as the web reader's does.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const finishReading = vi.fn(() => Promise.resolve());
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
}));
vi.mock("../../../../server/finish", () => ({ finishReading }));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://", "interval-platform": "android" };

afterEach(() => {
  vi.clearAllMocks();
});

const post = async (body: unknown, headers: Record<string, string> = APP) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/read/finish", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
};

test("Mark done finishes the section, or the article, from android", async () => {
  current.mockResolvedValue(account);
  expect((await post({ itemId: "5", momentId: "9" })).status).toBe(204);
  expect(finishReading).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "u1",
      source: "android",
      sessionId: null,
    }),
    "5",
    "9",
    "mark_done",
  );
  expect((await post({ itemId: "5" })).status).toBe(204);
  expect(finishReading).toHaveBeenLastCalledWith(
    expect.anything(),
    "5",
    undefined,
    "mark_done",
  );
});

test("a guest, another site or a bad body: refused", async () => {
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await post({ itemId: "5" })).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await post({ itemId: "5" }, {})).status).toBe(403);
  expect((await post({ itemId: "x" })).status).toBe(400);
  expect(finishReading).not.toHaveBeenCalled();
});
