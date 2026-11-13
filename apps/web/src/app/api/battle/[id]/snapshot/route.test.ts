import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  BattleSnapshots,
  FileStore,
} from "../../../../../server/ports";

// P5-W31-S04b (§6.9, Q-P5-17): the battle page's code, stored for review.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const claim = vi.fn<BattleSnapshots["claim"]>();
const put = vi.fn<FileStore["put"]>(() => Promise.resolve());
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  battleSnapshots: () => ({ claim }),
  files: () => ({ put }),
}));
vi.mock("../../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

const MATCH = "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b";
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const KEY = `battle-snapshots/${MATCH}/u1/2026-11-13T10:00:30.000Z.json`;

afterEach(() => {
  vi.clearAllMocks();
});

async function post(
  body: unknown,
  { id = MATCH, origin = "http://localhost:3100" } = {},
): Promise<Response> {
  const { POST } = await import("./route");
  return POST(
    new Request(`http://localhost:3100/api/battle/${id}/snapshot`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

test("a player's code is stored at the claimed key", async () => {
  current.mockResolvedValue(ada);
  claim.mockResolvedValue(KEY);
  const res = await post({ language: "python", code: "class Cache: ..." });
  expect(res.status).toBe(204);
  expect(claim).toHaveBeenCalledWith(MATCH, "u1", "python", expect.any(Date));
  const [key, bytes, type] = put.mock.calls[0] ?? [];
  expect([key, type]).toEqual([KEY, "application/json"]);
  expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
    language: "python",
    code: "class Cache: ...",
  });
});

test("not a player of the open battle, or too soon: nothing stored", async () => {
  current.mockResolvedValue(ada);
  claim.mockResolvedValue(null);
  expect((await post({ language: "go", code: "x" })).status).toBe(409);
  expect(put).not.toHaveBeenCalled();
});

test("another site, no session, or a bad body is refused before any claim", async () => {
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
    (await post({ language: "go", code: "x".repeat(256 * 1024 + 1) })).status,
  ).toBe(400);
  expect(
    (await post({ language: "go", code: "x" }, { id: "nope" })).status,
  ).toBe(400);
  // Too big to read: refused from its length, before it's parsed.
  expect(
    (await post({ language: "go", code: "x".repeat(300 * 1024) })).status,
  ).toBe(413);
  current.mockResolvedValue(null);
  expect((await post({ language: "go", code: "x" })).status).toBe(401);
  expect(claim).not.toHaveBeenCalled();
});

test("a store failure is an error, not a silent loss", async () => {
  current.mockResolvedValue(ada);
  claim.mockResolvedValue(KEY);
  put.mockRejectedValueOnce(new Error("bucket down"));
  await expect(post({ language: "go", code: "x" })).rejects.toThrow(
    "bucket down",
  );
});
