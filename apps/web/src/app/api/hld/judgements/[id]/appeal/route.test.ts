import { afterEach, expect, test, vi } from "vitest";
import type { Actor, HldJudgements } from "../../../../../../server/ports";

// P6-W41 (CANVAS-6, Q-P6-05): one appeal, within 7 days, with a short reason.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const appeal = vi.fn<HldJudgements["appeal"]>();
vi.mock("../../../../../../server/container", () => ({
  entitlements: () => ({ can: () => Promise.resolve(true) }),
  sessionReader: () => ({ current }),
  hldJudgements: () => ({ appeal }),
}));
vi.mock("../../../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

const ID = "0b6f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function post(body: unknown): Promise<Response> {
  const { POST } = await import("./route");
  return POST(
    new Request(`http://localhost:3100/api/hld/judgements/${ID}/appeal`, {
      method: "POST",
      headers: { origin: "http://localhost:3100" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: ID }) },
  );
}

test("an appeal with a reason is sent; a refused one says why", async () => {
  current.mockResolvedValue(ada);
  appeal.mockResolvedValueOnce("appealed");
  expect((await post({ reason: " Too low. " })).status).toBe(204);
  expect(appeal).toHaveBeenCalledWith(ID, "u1", "Too low.", expect.any(Date));
  appeal.mockResolvedValueOnce("twice");
  const refused = await post({ reason: "Again." });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({ refused: "twice" });
});

test("no reason, or a long one, is refused unsent", async () => {
  current.mockResolvedValue(ada);
  expect((await post({ reason: "  " })).status).toBe(400);
  expect((await post({ reason: "x".repeat(501) })).status).toBe(400);
  expect(appeal).not.toHaveBeenCalled();
});
