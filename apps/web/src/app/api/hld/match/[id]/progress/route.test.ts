import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../../../../server/ports";

// Q-WD-14: a player's poll of their opponents' scenario counts. Only a seated player of
// an open match is answered, only with counts, and not too often.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const allow = vi.fn<
  (key: string, limit: number, windowSeconds: number) => Promise<boolean>
>(() => Promise.resolve(true));
const progress = vi.fn<(userId: string, matchId: string) => Promise<unknown>>();
vi.mock("../../../../../../server/container", () => ({
  entitlements: () => ({ can: () => Promise.resolve(true) }),
  sessionReader: () => ({ current }),
  rateLimits: () => ({ allow }),
}));
vi.mock("../../../../../../server/hld-match-requests", () => ({
  matchProgress: progress,
}));

const ID = "0b6f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function get(id = ID) {
  const { GET } = await import("./route");
  return GET(
    new Request(`http://localhost:3100/api/hld/match/${id}/progress`),
    { params: Promise.resolve({ id }) },
  );
}

test("a seated player gets each opponent's count, and nothing more", async () => {
  current.mockResolvedValue(ada);
  progress.mockResolvedValue({
    total: 5,
    opponents: [{ player: "rsharma", passed: 3 }],
  });
  const res = await get();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({
    total: 5,
    opponents: [{ player: "rsharma", passed: 3 }],
  });
  expect(progress).toHaveBeenCalledWith("u1", ID);
});

test("signed out 401, not seated 403, an over match 409, a bad id 400", async () => {
  current.mockResolvedValueOnce(null);
  expect((await get()).status).toBe(401);
  current.mockResolvedValue(ada);
  progress.mockResolvedValueOnce("not_player");
  expect((await get()).status).toBe(403);
  progress.mockResolvedValueOnce("closed");
  const over = await get();
  expect(over.status).toBe(409);
  expect(await over.json()).toEqual({ over: true });
  expect((await get("not-a-uuid")).status).toBe(400);
});

test("polling past the limit is refused before anything is simulated", async () => {
  current.mockResolvedValue(ada);
  allow.mockResolvedValueOnce(false);
  expect((await get()).status).toBe(429);
  expect(allow).toHaveBeenCalledWith("hld-progress:u1", 30, 60);
  expect(progress).not.toHaveBeenCalled();
});
