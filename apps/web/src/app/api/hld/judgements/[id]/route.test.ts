import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  HldJudgement,
  HldJudgements,
} from "../../../../../server/ports";

// P6-W41 (CANVAS-6, Q-P6-05): a player's own judgement, with its rubric points; the
// owner's levels, once an appeal is resolved, replace the judge's.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const get = vi.fn<HldJudgements["get"]>();
vi.mock("../../../../../server/container", () => ({
  entitlements: () => ({ can: () => Promise.resolve(true) }),
  sessionReader: () => ({ current }),
  hldJudgements: () => ({ get }),
}));

const ID = "0b6f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const judgement: HldJudgement = {
  id: ID,
  problemSlug: "url-shortener",
  status: "ready",
  baselinePassed: true,
  levels: {
    caching: { level: 2, reason: "Reasoned." },
    codes: { level: 2, reason: "Reasoned." },
  },
  coach: "Add a replica.",
  requestedAt: new Date(),
  appealedAt: null,
  ownerLevels: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

async function read(): Promise<Response> {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost:3100/api/hld/judgements/${ID}`), {
    params: Promise.resolve({ id: ID }),
  });
}

test("the judge's levels make the rubric points", async () => {
  current.mockResolvedValue(ada);
  get.mockResolvedValueOnce(judgement);
  const body = (await (await read()).json()) as Record<string, unknown>;
  expect(body).toMatchObject({ rubricPoints: 12.5, coach: "Add a replica." });
  expect(get).toHaveBeenCalledWith(ID, "u1");
});

test("an owner's re-grade replaces the judge's", async () => {
  current.mockResolvedValue(ada);
  get.mockResolvedValueOnce({
    ...judgement,
    appealedAt: new Date(),
    ownerLevels: {
      caching: { level: 4, reason: "Owner." },
      codes: { level: 4, reason: "Owner." },
    },
  });
  expect(await (await read()).json()).toMatchObject({
    rubricPoints: 25,
    appealed: true,
    regraded: true,
  });
});

// Found by the walkthrough: a request whose job was lost stayed "pending" forever, and
// the panel kept its button disabled, so the player could never ask again.
test("a request still pending past the stale limit shows as unavailable, so it can be asked again", async () => {
  current.mockResolvedValue(ada);
  get.mockResolvedValueOnce({
    ...judgement,
    status: "pending",
    levels: null,
    coach: null,
    requestedAt: new Date(Date.now() - 20 * 60_000),
  });
  expect(await (await read()).json()).toMatchObject({ status: "unavailable" });
  get.mockResolvedValueOnce({
    ...judgement,
    status: "pending",
    levels: null,
    coach: null,
    requestedAt: new Date(),
  });
  expect(await (await read()).json()).toMatchObject({ status: "pending" });
});

test("someone else's, or none: not found", async () => {
  current.mockResolvedValue(ada);
  get.mockResolvedValueOnce(null);
  expect((await read()).status).toBe(404);
});
