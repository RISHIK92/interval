import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Challenges,
  Entitlements,
  LiveMatch,
} from "../../../server/ports";

// P3-W17-S03 (Q-P3-16): making a link, and accepting one: taken once, while its sender
// is online, into a private unrated match the sender is told about.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const create = vi.fn<Challenges["create"]>(() => Promise.resolve("tok"));
const beat = vi.fn<Challenges["beat"]>(() => Promise.resolve());
const peek = vi.fn<Challenges["peek"]>();
const online = vi.fn<Challenges["online"]>(() => Promise.resolve(true));
const take = vi.fn<Challenges["take"]>();
const notify = vi.fn<Challenges["notify"]>(() => Promise.resolve());
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const privateMatch =
  vi.fn<(players: string[], mode: string) => Promise<LiveMatch>>();
let gameConfigured = true;
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  challenges: () => ({ create, beat, peek, online, take, notify }),
  entitlements: () => ({ can }),
  privateMatch,
}));
vi.mock("../../../env", () => ({
  gameEnv: () => (gameConfigured ? { GAME_TICKET_SECRET: "s" } : null),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
const requireUsername = vi.fn(() => Promise.resolve());
vi.mock("../../username/gate", () => ({ requireUsername }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
  gameConfigured = true;
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

test("a link is made for the chosen game, and its maker counts as online", async () => {
  current.mockResolvedValue(guest);
  const { createChallengeAction } = await import("./actions");
  await expect(createChallengeAction(form({ mode: "sprint" }))).rejects.toThrow(
    "redirect:/play/challenge?t=tok",
  );
  expect(create).toHaveBeenCalledWith("g1", "sprint");
  expect(beat).toHaveBeenCalledWith("g1");
  await expect(createChallengeAction(form({ mode: "chess" }))).rejects.toThrow(
    "redirect:/play/challenge",
  );
  gameConfigured = false;
  await expect(createChallengeAction(form({ mode: "sprint" }))).rejects.toThrow(
    "redirect:/play",
  );
});

test("accepting: taken, the private match made, the sender told, into the match", async () => {
  current.mockResolvedValue(guest);
  peek.mockResolvedValue({
    status: "open",
    sender: "u9",
    mode: "fastest_finger",
  });
  take.mockResolvedValueOnce({
    status: "open",
    sender: "u9",
    mode: "fastest_finger",
  });
  privateMatch.mockResolvedValueOnce({
    id: "m-7",
    serverId: 0,
    players: ["u9", "g1"],
    mode: "fastest_finger",
    rounds: [],
  });
  const { acceptChallengeAction } = await import("./actions");
  await expect(
    acceptChallengeAction(form({ token: "AbCdEfGhIjKlMnOpQrStUv" })),
  ).rejects.toThrow("redirect:/play/live/fastest-finger?match=m-7");
  expect(privateMatch).toHaveBeenCalledWith(["u9", "g1"], "fastest_finger");
  expect(notify).toHaveBeenCalledWith("u9", {
    matchId: "m-7",
    mode: "fastest_finger",
  });
});

test("not open, the sender offline, or taken first: back to the link, no match", async () => {
  current.mockResolvedValue(guest);
  const { acceptChallengeAction } = await import("./actions");
  peek.mockResolvedValueOnce({ status: "expired" });
  await expect(
    acceptChallengeAction(form({ token: "AbCdEfGhIjKlMnOpQrStUv" })),
  ).rejects.toThrow("redirect:/c/AbCdEfGhIjKlMnOpQrStUv");
  peek.mockResolvedValueOnce({ status: "open", sender: "u9", mode: "sprint" });
  online.mockResolvedValueOnce(false);
  await expect(
    acceptChallengeAction(form({ token: "AbCdEfGhIjKlMnOpQrStUv" })),
  ).rejects.toThrow("redirect:/c/AbCdEfGhIjKlMnOpQrStUv");
  expect(take).not.toHaveBeenCalled();
  peek.mockResolvedValueOnce({ status: "open", sender: "u9", mode: "sprint" });
  take.mockResolvedValueOnce({ status: "taken" });
  await expect(
    acceptChallengeAction(form({ token: "AbCdEfGhIjKlMnOpQrStUv" })),
  ).rejects.toThrow("redirect:/c/AbCdEfGhIjKlMnOpQrStUv");
  expect(privateMatch).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

test("an account makes a link only with its username", async () => {
  current.mockResolvedValue(account);
  const { createChallengeAction } = await import("./actions");
  await expect(
    createChallengeAction(form({ mode: "fastest_finger" })),
  ).rejects.toThrow("redirect:/play/challenge?t=tok");
  expect(requireUsername).toHaveBeenCalledWith("u1", "/play/challenge");
});

test("a sprint challenge needs the sprint on the plan, for its maker and its friend", async () => {
  current.mockResolvedValue(guest);
  can.mockImplementation((_, c) => Promise.resolve(c !== "play.sprint"));
  const { createChallengeAction, acceptChallengeAction } =
    await import("./actions");
  await expect(createChallengeAction(form({ mode: "sprint" }))).rejects.toThrow(
    "redirect:/play",
  );
  expect(create).not.toHaveBeenCalled();
  peek.mockResolvedValueOnce({ status: "open", sender: "u9", mode: "sprint" });
  await expect(
    acceptChallengeAction(form({ token: "AbCdEfGhIjKlMnOpQrStUv" })),
  ).rejects.toThrow("redirect:/c/AbCdEfGhIjKlMnOpQrStUv?unplayable=1");
  expect(take).not.toHaveBeenCalled();
  can.mockImplementation(() => Promise.resolve(true));
});

test("a match that can't start is said and logged; a bad token is no challenge", async () => {
  current.mockResolvedValue(guest);
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  peek.mockResolvedValueOnce({ status: "open", sender: "u9", mode: "sprint" });
  take.mockResolvedValueOnce({ status: "open", sender: "u9", mode: "sprint" });
  privateMatch.mockRejectedValueOnce(new Error("not enough live questions"));
  const { acceptChallengeAction } = await import("./actions");
  await expect(
    acceptChallengeAction(form({ token: "AbCdEfGhIjKlMnOpQrStUv" })),
  ).rejects.toThrow("redirect:/c/AbCdEfGhIjKlMnOpQrStUv?failed=1");
  expect(out.mock.calls.map(([c]) => String(c)).join("")).toContain(
    "game: challenge not started",
  );
  expect(notify).not.toHaveBeenCalled();
  out.mockRestore();
  await expect(acceptChallengeAction(form({ token: "../x" }))).rejects.toThrow(
    "redirect:/play",
  );
  gameConfigured = false;
  peek.mockResolvedValueOnce({
    status: "open",
    sender: "u9",
    mode: "fastest_finger",
  });
  await expect(
    acceptChallengeAction(form({ token: "AbCdEfGhIjKlMnOpQrStUv" })),
  ).rejects.toThrow("unplayable=1");
});
