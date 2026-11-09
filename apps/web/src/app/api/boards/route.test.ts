import { BoardResponse } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../server/ports";

// P4-W21-S03 (§6.7): a board for the app, as the web's boards page reads it.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const usernameOf = vi.fn(() => Promise.resolve<string | null>("ada"));
const readBoard = vi.fn();
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  usernames: () => ({ get: usernameOf }),
}));
vi.mock("../../../server/board-view", async (actual) => ({
  ...(await actual<typeof import("../../../server/board-view")>()),
  readBoard,
}));
vi.mock("../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const guest: Actor = { ...account, userId: "g1", isGuest: true };
const APP = { "expo-origin": "interval://" };
const rows = {
  kind: "rows",
  rows: [{ id: "u1", name: "@ada", score: "3", rank: 1 }],
  mine: "u1",
  mark: "You",
  unit: "Correct answers over the week's sprints",
  pinned: { id: "u1", name: "@ada", score: "3", rank: 1, note: "#1 · top 1%" },
  missing: "not_yet",
};
afterEach(() => {
  vi.clearAllMocks();
});
const get = async (query = "", headers: Record<string, string> = APP) => {
  const { GET } = await import("./route");
  return GET(
    new Request(`http://localhost:3100/api/boards${query}`, { headers }),
  );
};

test("a board with its chips' labels, read for the asked game, scope and period", async () => {
  current.mockResolvedValue(account);
  readBoard.mockResolvedValue({
    game: "sprint",
    scope: "global",
    period: "previous",
    scopes: ["global", "country", "university", "friends", "universities"],
    body: rows,
  });
  const body = BoardResponse.parse(
    await (await get("?game=sprint&period=previous")).json(),
  );
  expect(readBoard).toHaveBeenCalledWith(
    account,
    { game: "sprint", scope: undefined, period: "previous" },
    expect.any(Date),
  );
  expect(body.periods).toEqual([
    { key: "current", label: "This week" },
    { key: "previous", label: "Last week" },
  ]);
  expect(body.scopes).toHaveLength(5);
  expect(body.body).toEqual(rows);
});

test("a guest's scopes are the guest's; an account picks a username first", async () => {
  current.mockResolvedValue(guest);
  readBoard.mockResolvedValue({
    game: "daily",
    scope: "global",
    period: "current",
    scopes: ["global", "universities"],
    body: { kind: "unset", what: "follows" },
  });
  const body = BoardResponse.parse(await (await get()).json());
  expect(body.scopes.map((s) => s.key)).toEqual(["global", "universities"]);
  expect(usernameOf).not.toHaveBeenCalled();
  current.mockResolvedValue(account);
  usernameOf.mockResolvedValueOnce(null);
  const noName = await get();
  expect(noName.status).toBe(409);
  expect(await noName.json()).toEqual({ setup: "username" });
});

test("no session or another site: refused", async () => {
  current.mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  expect((await get("", {})).status).toBe(403);
});
