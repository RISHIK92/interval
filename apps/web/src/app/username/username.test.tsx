import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Actor, Usernames } from "../../server/ports";
import { usernameOf } from "../../server/usernames";

// P3-W14-S05 (Q-P3-11; owner, 2026-11-02): every account chooses a username once.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const get = vi.fn<Usernames["get"]>(() => Promise.resolve(null));
const claim = vi.fn<Usernames["claim"]>(() =>
  Promise.resolve("claimed" as const),
);
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  usernames: () => ({ get, claim }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const guest: Actor = { ...account, isGuest: true };

afterEach(() => {
  vi.clearAllMocks();
});

test.each([
  ["ada", "ada"],
  ["  Ada_Lovelace1 ", "ada_lovelace1"],
  ["abc", "abc"],
  ["a".repeat(20), "a".repeat(20)],
  ["ab", null],
  ["a".repeat(21), null],
  ["ada lovelace", null],
  ["ada-l", null],
  ["adá", null],
  ["", null],
])("usernameOf(%j) is %j", (raw, expected) => {
  expect(usernameOf(raw)).toBe(expected);
});

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: UsernamePage } = await import("./page");
  return renderToStaticMarkup(
    await UsernamePage({ searchParams: Promise.resolve(query) }),
  );
}

describe("the page", () => {
  test("asks once, says it can't be changed, and carries where to go back", async () => {
    current.mockResolvedValue(account);
    const html = await page({ next: "/play" });
    expect(html).toContain("Choose your username");
    expect(html).toContain("can&#x27;t be changed");
    expect(html).toMatch(/<input[^>]*name="username"/);
    expect(html).toMatch(
      /<input[^>]*type="hidden"[^>]*name="next"[^>]*value="\/play"/,
    );
  });

  test("an account that has one goes on; a guest or nobody is sent away", async () => {
    current.mockResolvedValue(account);
    get.mockResolvedValueOnce({ username: "ada", searchable: true });
    await expect(page({ next: "/profile" })).rejects.toThrow(
      "redirect:/profile",
    );
    current.mockResolvedValue(guest);
    await expect(page()).rejects.toThrow("redirect:/play");
    current.mockResolvedValue(null);
    await expect(page()).rejects.toThrow("redirect:/join");
  });

  test.each([
    ["taken", "That username is taken. Try another."],
    ["format", "3 to 20 letters a–z, digits or _."],
  ])("explains %s, tied to the field", async (error, text) => {
    current.mockResolvedValue(account);
    const html = await page({ error });
    expect(html).toContain(text);
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    expect(html).toMatch(/aria-describedby="username-rule username-error"/);
  });

  test("a taken name is shown again to edit, only if it is a username", async () => {
    current.mockResolvedValue(account);
    expect(await page({ error: "taken", tried: "ada" })).toMatch(
      /<input[^>]*value="ada"/,
    );
    expect(await page({ error: "taken", tried: "<b>" })).not.toMatch(
      /<input[^>]*name="username"[^>]*value=/,
    );
  });
});

describe("the action", () => {
  const form = (username: string, next = "/play") => {
    const data = new FormData();
    data.set("username", username);
    data.set("next", next);
    return data;
  };

  test("claims it and goes back", async () => {
    const { chooseUsernameAction } = await import("./actions");
    current.mockResolvedValue(account);
    await expect(chooseUsernameAction(form(" Ada "))).rejects.toThrow(
      "redirect:/play",
    );
    expect(claim).toHaveBeenCalledExactlyOnceWith("u1", "ada");
  });

  test("taken, or not a username: asked again, with where to go back and what was typed", async () => {
    const { chooseUsernameAction } = await import("./actions");
    current.mockResolvedValue(account);
    claim.mockResolvedValueOnce("taken");
    await expect(chooseUsernameAction(form("ada"))).rejects.toThrow(
      "redirect:/username?error=taken&next=%2Fplay&tried=ada",
    );
    await expect(chooseUsernameAction(form("a b"))).rejects.toThrow(
      "redirect:/username?error=format&next=%2Fplay",
    );
    expect(claim).toHaveBeenCalledOnce();
  });

  test("already has one: goes back, nothing changes", async () => {
    const { chooseUsernameAction } = await import("./actions");
    current.mockResolvedValue(account);
    claim.mockResolvedValueOnce("has-one");
    await expect(chooseUsernameAction(form("bob"))).rejects.toThrow(
      "redirect:/play",
    );
  });

  test.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil",
    "",
    "/username?next=%2F",
    "/\t/evil.example",
    "/./username",
  ])("goes back only within the app (%j becomes the feed)", async (next) => {
    const { chooseUsernameAction } = await import("./actions");
    current.mockResolvedValue(account);
    await expect(chooseUsernameAction(form("ada", next))).rejects.toThrow(
      /^redirect:\/$/,
    );
  });

  test("a guest or nobody claims nothing", async () => {
    const { chooseUsernameAction } = await import("./actions");
    current.mockResolvedValue(guest);
    await expect(chooseUsernameAction(form("ada"))).rejects.toThrow(
      "redirect:/play",
    );
    current.mockResolvedValue(null);
    await expect(chooseUsernameAction(form("ada"))).rejects.toThrow(
      "redirect:/join",
    );
    expect(claim).not.toHaveBeenCalled();
  });
});
