import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../server/ports";

// P4-W20-S02 (§5I): the app's note on what the reader shows; empty deletes it.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const writeNote = vi.fn(() => Promise.resolve());
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
}));
vi.mock("../../../server/note-writes", () => ({ writeNote }));
vi.mock("../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://", "interval-platform": "ios" };

afterEach(() => {
  vi.clearAllMocks();
});

const put = async (body: unknown, headers: Record<string, string> = APP) => {
  const { PUT } = await import("./route");
  return PUT(
    new Request("http://localhost:3100/api/notes", {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
};

test("a note is written, trimmed, on the section or the article", async () => {
  current.mockResolvedValue(account);
  const on = { itemId: "5", momentId: "9", body: "  Leader leases.  " };
  expect((await put(on)).status).toBe(204);
  expect(writeNote).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "u1", source: "ios" }),
    { itemId: "5", momentId: "9" },
    "Leader leases.",
  );
  expect((await put({ itemId: "5", body: "" })).status).toBe(204);
  expect(writeNote).toHaveBeenLastCalledWith(
    expect.anything(),
    { itemId: "5", momentId: null },
    "",
  );
});

test("a guest, another site, or a note too long: refused", async () => {
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await put({ itemId: "5", body: "x" })).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await put({ itemId: "5", body: "x" }, {})).status).toBe(403);
  expect((await put({ itemId: "5", body: "x".repeat(2001) })).status).toBe(400);
  expect(writeNote).not.toHaveBeenCalled();
});
