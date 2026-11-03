import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Challenges, Usernames } from "../../../server/ports";

// P3-W17-S03 (Q-P3-16, Q-P3-03): a challenge link says where it stands and takes
// nothing by being opened; guests can play it.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const peek = vi.fn<Challenges["peek"]>();
const online = vi.fn<Challenges["online"]>(() => Promise.resolve(true));
const take = vi.fn<Challenges["take"]>();
const labels = vi.fn<Usernames["labels"]>((ids) =>
  Promise.resolve(
    ids.map((userId) => ({ userId, username: "ada", guest: false })),
  ),
);
const requireUsername = vi.fn(() => Promise.resolve());
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  challenges: () => ({ peek, online, take }),
  usernames: () => ({ labels }),
}));
vi.mock("../../username/gate", () => ({ requireUsername }));
vi.mock("../../play/challenge/actions", () => ({
  acceptChallengeAction: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };
const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function page(
  token = "AbCdEfGhIjKlMnOpQrStUv",
  query: { failed?: string; unplayable?: string } = {},
): Promise<string> {
  const { default: ChallengeLinkPage } = await import("./page");
  return renderToStaticMarkup(
    await ChallengeLinkPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve(query),
    }),
  ).replace(/<[^>]+>/g, "|");
}

test("signed out: sign in or play as a guest, then open it again", async () => {
  current.mockResolvedValue(null);
  const text = await page();
  expect(text).toContain("Sign in, or play as a guest");
  expect(peek).not.toHaveBeenCalled();
});

test.each([
  ["expired", "This challenge has expired"],
  ["taken", "Someone already accepted this challenge"],
  ["own", "This is your own challenge link"],
] as const)("%s says so", async (status, line) => {
  current.mockResolvedValue(guest);
  peek.mockResolvedValueOnce({ status });
  expect(await page()).toContain(line);
});

test("the sender offline: said plainly, and nothing taken", async () => {
  current.mockResolvedValue(guest);
  peek.mockResolvedValueOnce({ status: "open", sender: "u9", mode: "sprint" });
  online.mockResolvedValueOnce(false);
  const text = await page();
  expect(text).toContain("@ada isn");
  expect(text).toContain("online right now");
  expect(take).not.toHaveBeenCalled();
});

test("open and the sender online: a guest gets Play now, opening takes nothing", async () => {
  current.mockResolvedValue(guest);
  peek.mockResolvedValueOnce({
    status: "open",
    sender: "u9",
    mode: "fastest_finger",
  });
  const text = await page();
  expect(text).toContain("@ada challenged you to fastest finger");
  expect(text).toContain("Play @ada now");
  expect(take).not.toHaveBeenCalled();
  expect(requireUsername).not.toHaveBeenCalled();
  // An account needs its username first.
  current.mockResolvedValue(account);
  peek.mockResolvedValueOnce({ status: "open", sender: "u9", mode: "sprint" });
  await page("AbCdEfGhIjKlMnOpQrSt22");
  expect(requireUsername).toHaveBeenCalledWith(
    "u1",
    "/c/AbCdEfGhIjKlMnOpQrSt22",
  );
});

test("a token of another shape is no challenge; a failed start and an unplayable game say so", async () => {
  current.mockResolvedValue(guest);
  expect(await page("../../x")).toContain("This challenge has expired");
  expect(peek).not.toHaveBeenCalled();
  expect(await page("AbCdEfGhIjKlMnOpQrStUv", { failed: "1" })).toContain(
    "The match couldn",
  );
  peek.mockResolvedValueOnce({ status: "open", sender: "u9", mode: "sprint" });
  expect(await page("AbCdEfGhIjKlMnOpQrStUv", { unplayable: "1" })).toContain(
    "on both your plans",
  );
});
