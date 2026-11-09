import { PathResponse, PathsResponse } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  PathSummary,
  PathTimeline,
  Preferences,
} from "../../../server/ports";

// P4-W21-S03 (§5F): topic paths in the app: the list, a path, Start and Pause.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const prefs = vi.fn(() =>
  Promise.resolve<Preferences | null>({} as Preferences),
);
const live = vi.fn<() => Promise<PathSummary[]>>();
const path = vi.fn<() => Promise<PathTimeline | null>>();
const startPath = vi.fn(() => Promise.resolve(true));
const pausePath = vi.fn(() => Promise.resolve(true));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get: prefs }),
  paths: () => ({ live, path }),
}));
vi.mock("../../../server/path-flow", () => ({ startPath, pausePath }));
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
const list = async (headers: Record<string, string> = APP) => {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost:3100/api/paths", { headers }));
};
const one = async (id = "3") => {
  const { GET } = await import("./[path]/route");
  return GET(
    new Request(`http://localhost:3100/api/paths/${id}`, { headers: APP }),
    { params: Promise.resolve({ path: id }) },
  );
};
const act = async (action: string, id = "3") => {
  const { POST } = await import("./[path]/route");
  return POST(
    new Request(`http://localhost:3100/api/paths/${id}`, {
      method: "POST",
      headers: { ...APP, "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ path: id }) },
  );
};

test("the live paths, the user's active one marked", async () => {
  current.mockResolvedValue(account);
  live.mockResolvedValue([
    {
      pathId: "3",
      name: "Distributed systems",
      why: "Consensus to caching",
      sections: 6,
      readings: 18,
      minutes: 120,
      mine: "active",
      retired: false,
      topic: null,
      fitsGoal: true,
    },
  ]);
  const body = PathsResponse.parse(await (await list()).json());
  expect(body.paths[0]).toMatchObject({ pathId: "3", mine: "active" });
});

test("a path's sections: readings, checkpoint state; not theirs or unknown is 404", async () => {
  current.mockResolvedValue(account);
  path.mockResolvedValueOnce({
    pathId: "3",
    name: "Distributed systems",
    why: "Consensus to caching",
    retired: false,
    mine: "active",
    sections: [
      {
        sectionId: "12",
        concepts: ["Raft"],
        open: true,
        checkpoint: "ready",
        skipped: false,
        warning: null,
        holdsBack: false,
        mastered: false,
        foundations: [],
        size: 5,
        passMark: 4,
        readings: [
          {
            itemId: "5",
            momentId: "9",
            sectionTitle: "Leader election",
            articleTitle: "Raft",
            sourceName: "A blog",
            minutes: 6,
            frameable: true,
            linkBroken: false,
            finished: true,
            ordinal: 0,
          },
        ],
      },
    ],
  });
  const body = PathResponse.parse(await (await one()).json());
  expect(body.sections[0]).toMatchObject({
    checkpoint: "ready",
    readings: [{ itemId: "5", momentId: "9", finished: true }],
  });
  path.mockResolvedValueOnce(null);
  expect((await one()).status).toBe(404);
  expect((await one("x")).status).toBe(400);
});

test("Start and Pause go through the web's flow, with the app's platform", async () => {
  current.mockResolvedValue(account);
  expect((await act("start")).status).toBe(204);
  expect(startPath).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "u1", source: "ios", sessionId: null }),
    "3",
  );
  pausePath.mockResolvedValueOnce(false);
  expect((await act("pause")).status).toBe(404);
  expect((await act("leave")).status).toBe(400);
});

test("guests, accounts not onboarded, and other sites: refused", async () => {
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await list()).status).toBe(401);
  current.mockResolvedValue(account);
  prefs.mockResolvedValueOnce(null);
  const notYet = await list();
  expect(notYet.status).toBe(409);
  expect(await notYet.json()).toEqual({ setup: "onboarding" });
  expect((await list({})).status).toBe(403);
  expect(live).not.toHaveBeenCalled();
});
