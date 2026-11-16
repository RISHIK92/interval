import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../../../../server/ports";

// P6-W44 (Q-P6-03, Q-P6-08): a match's autosave as a route: signed in, same origin, the
// body capped before it's parsed, and each refusal its own status.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const save = vi.fn<
  (
    userId: string,
    matchId: string,
    design: unknown,
    base: unknown,
  ) => Promise<unknown>
>(() => Promise.resolve({ ok: true, version: 3 }));
vi.mock("../../../../../../server/container", () => ({
  entitlements: () => ({ can: () => Promise.resolve(true) }),
  sessionReader: () => ({ current }),
}));
vi.mock("../../../../../../server/hld-match-requests", () => ({
  saveMatchDesign: save,
}));
vi.mock("../../../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

const ID = "0b6f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function put(body: string, origin = "http://localhost:3100", id = ID) {
  const { PUT } = await import("./route");
  return PUT(
    new Request(`http://localhost:3100/api/hld/match/${id}/design`, {
      method: "PUT",
      headers: { origin, "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );
}

test("a save goes through for the signed-in player", async () => {
  current.mockResolvedValue(ada);
  const res = await put(JSON.stringify({ design: { a: 1 }, base: 2 }));
  expect(res.status).toBe(200);
  expect(save).toHaveBeenCalledWith("u1", ID, { a: 1 }, 2);
});

test("refusals keep their reasons: invalid 400, stale or closed 409", async () => {
  current.mockResolvedValue(ada);
  save.mockResolvedValueOnce({ ok: false, reason: "invalid" });
  expect((await put(JSON.stringify({ design: {}, base: 0 }))).status).toBe(400);
  save.mockResolvedValueOnce({ ok: false, reason: "stale" });
  const stale = await put(JSON.stringify({ design: {}, base: 0 }));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ ok: false, reason: "stale" });
});

test("signed out, another origin, too large, not JSON or a bad id: refused unsaved", async () => {
  current.mockResolvedValueOnce(null);
  expect((await put("{}")).status).toBe(401);
  current.mockResolvedValue(ada);
  expect((await put("{}", "https://elsewhere.example")).status).toBe(403);
  const huge = JSON.stringify({ design: "x".repeat(200 * 1024), base: 0 });
  expect((await put(huge)).status).toBe(413);
  expect((await put("{not json")).status).toBe(400);
  expect((await put("{}", undefined, "not-a-uuid")).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});
