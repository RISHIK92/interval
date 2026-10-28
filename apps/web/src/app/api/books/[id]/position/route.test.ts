import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Books } from "../../../../../server/ports";

// P2-W11-S04: the reader's place, posted by KeepPlace.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const savePosition = vi.fn<Books["savePosition"]>(() => Promise.resolve(true));
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  books: () => ({ savePosition }),
}));
vi.mock("../../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function post(
  body: unknown,
  { origin = "http://localhost:3100", id = "7" } = {},
): Promise<number> {
  const { POST } = await import("./route");
  const response = await POST(
    new Request(`http://localhost:3100/api/books/${id}/position`, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return response.status;
}

test("the owner's place is saved", async () => {
  current.mockResolvedValue(user);
  expect(await post({ sessionId: "71", fraction: 0.4 })).toBe(204);
  expect(savePosition).toHaveBeenCalledWith("u1", "7", "71", 0.4);
  savePosition.mockResolvedValueOnce(false);
  expect(await post({ sessionId: "71", fraction: 0.4 })).toBe(404);
});

test("another site, the signed out and bad input are refused", async () => {
  current.mockResolvedValue(user);
  expect(
    await post(
      { sessionId: "71", fraction: 0.4 },
      { origin: "https://evil.example" },
    ),
  ).toBe(403);
  expect(await post({ sessionId: "71", fraction: 1.5 })).toBe(400);
  expect(await post({ sessionId: "x", fraction: 0.4 })).toBe(400);
  expect(await post({ sessionId: "71", fraction: 0.4 }, { id: "x" })).toBe(400);
  current.mockResolvedValue(null);
  expect(await post({ sessionId: "71", fraction: 0.4 })).toBe(401);
  expect(savePosition).not.toHaveBeenCalled();
});
