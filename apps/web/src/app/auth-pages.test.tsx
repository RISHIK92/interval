import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Accounts, Actor, FeedCard } from "../server/ports";

// The account pages and their server actions, with the container and Next mocked.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const port = {
  signUp: vi.fn<Accounts["signUp"]>(),
  signIn: vi.fn<Accounts["signIn"]>(),
  signOut: vi.fn<Accounts["signOut"]>(() => Promise.resolve()),
  requestReset: vi.fn<Accounts["requestReset"]>(() => Promise.resolve()),
  resetPassword: vi.fn<Accounts["resetPassword"]>(),
};
const emit = vi.fn();
const setCookie = vi.fn();
const deleteCookie = vi.fn();
vi.mock("../server/container", () => ({
  sessionReader: () => ({ current }),
  accounts: () => port,
  events: () => ({ emit }),
  feedReader: () => ({
    read: () => Promise.resolve({ computed: true, cards: [] as FeedCard[] }),
  }),
  entitlements: () => ({ can: () => Promise.resolve(true) }),
  feedback: () => ({ notInterested: () => Promise.resolve(false) }),
  progress: () => ({ continueCards: () => Promise.resolve([]) }),
  notes: () => ({ onItems: () => Promise.resolve([]) }),
  quizzes: () => ({
    offered: () => Promise.resolve(new Set()),
    dueReviews: () => Promise.resolve([]),
  }),
  paths: () => ({ next: () => Promise.resolve(null) }),
  books: () => ({ nextSession: () => Promise.resolve(null) }),
  // Onboarded (P1-W4-S01), so the home page renders.
  preferences: () => ({
    get: () =>
      Promise.resolve({
        topics: ["backend"],
        level: "beginner",
        breakLength: "3-8",
        firstName: null,
        onboardedAt: new Date("2026-01-01T00:00:00Z"),
      }),
  }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-9.1790000000" } : undefined,
      set: setCookie,
      delete: deleteCookie,
    }),
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

afterEach(() => {
  vi.clearAllMocks();
});

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };
const account: Actor = { userId: "a1", isGuest: false, betaGroup: "student" };
const PASSWORD = "correct horse battery";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function html(
  page: Promise<ReactElement> | ReactElement,
): Promise<string> {
  return renderToStaticMarkup(await page);
}

describe("home", () => {
  async function home(): Promise<string> {
    const { default: HomePage } = await import("./page");
    return html(HomePage({ searchParams: Promise.resolve({}) }));
  }

  test("a guest is offered sign-up, not sign-out", async () => {
    current.mockResolvedValue(guest);
    const page = await home();
    expect(page).toContain('href="/sign-up"');
    expect(page).not.toContain("Sign out");
  });

  test("an account gets a sign-out button", async () => {
    current.mockResolvedValue(account);
    const page = await home();
    expect(page).toContain("Sign out");
    expect(page).not.toContain('href="/sign-up"');
  });
});

describe("sign-up", () => {
  async function page(): Promise<string> {
    const { default: SignUpPage } = await import("./sign-up/page");
    return html(SignUpPage());
  }

  test.each([
    ["no session", null, "/join"],
    ["an account", account, "/"],
  ] as const)("%s is sent to %s", async (_who, actor, target) => {
    current.mockResolvedValue(actor);
    await expect(page()).rejects.toThrow(`redirect:${target}`);
  });

  test("a guest sees the form", async () => {
    current.mockResolvedValue(guest);
    expect(await page()).toContain('name="password"');
  });

  test("a successful sign-up goes home; a refusal shows its message", async () => {
    const { signUpAction } = await import("./sign-up/actions");
    const fields = {
      name: "Ada",
      email: "ada@example.test",
      password: PASSWORD,
    };
    current.mockResolvedValue(guest);
    port.signUp.mockResolvedValueOnce({ ok: true, setCookies: [] });
    await expect(signUpAction(null, form(fields))).rejects.toThrow(
      "redirect:/",
    );
    // The guest's row became the account: same user id, now not a guest.
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "signup_completed",
      {},
      {
        userId: "g1",
        isGuest: false,
        betaGroup: "student",
        sessionId: "visit-9",
      },
    );
    emit.mockClear();
    port.signUp.mockResolvedValueOnce({ ok: false, reason: "email_taken" });
    expect(await signUpAction(null, form(fields))).toEqual({
      message: "An account with that email already exists. Sign in instead.",
    });
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("sign-in", () => {
  async function page(reset?: string): Promise<string> {
    const { default: SignInPage } = await import("./sign-in/page");
    return html(
      SignInPage({
        searchParams: Promise.resolve(reset === undefined ? {} : { reset }),
      }),
    );
  }

  test("an account is sent home; a guest can still sign in to an existing account", async () => {
    current.mockResolvedValue(account);
    await expect(page()).rejects.toThrow("redirect:/");
    current.mockResolvedValue(guest);
    expect(await page()).toContain('name="password"');
  });

  test("after a reset the page says the password changed", async () => {
    current.mockResolvedValue(null);
    expect(await page("1")).toContain("Your password was changed.");
    expect(await page()).not.toContain("Your password was changed.");
  });

  test("the right password goes home; a wrong one shows the generic message", async () => {
    const { signInAction } = await import("./sign-in/actions");
    const fields = { email: "ada@example.test", password: PASSWORD };
    port.signIn.mockResolvedValueOnce({ setCookies: [], actor: account });
    await expect(signInAction(null, form(fields))).rejects.toThrow(
      "redirect:/",
    );
    // A sign-in starts a new visit for the user now on this browser.
    const [name, value] = setCookie.mock.calls[0] as [string, string];
    expect(name).toBe("iv_visit");
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "session_started",
      {},
      {
        ...account,
        sessionId: value.split(".")[0],
      },
    );
    emit.mockClear();
    port.signIn.mockResolvedValueOnce(null);
    expect(await signInAction(null, form(fields))).toEqual({
      message: "Email or password is incorrect.",
    });
  });
});

describe("password reset", () => {
  test("asking for a link answers the same whether or not the account exists", async () => {
    const { forgotPasswordAction } = await import("./forgot-password/actions");
    const message =
      "If an account exists for that email, we've sent a reset link.";
    expect(
      await forgotPasswordAction(null, form({ email: "ada@example.test" })),
    ).toEqual({ message });
    expect(await forgotPasswordAction(null, form({ email: "nope" }))).toEqual({
      message,
    });
    expect(port.requestReset).toHaveBeenCalledExactlyOnceWith(
      "ada@example.test",
    );
  });

  test("the reset page without a token says the link is invalid", async () => {
    const { default: ResetPasswordPage } =
      await import("./reset-password/page");
    expect(
      await html(ResetPasswordPage({ searchParams: Promise.resolve({}) })),
    ).toContain("That reset link is invalid or has expired.");
    const withToken = await html(
      ResetPasswordPage({ searchParams: Promise.resolve({ token: "tok123" }) }),
    );
    expect(withToken).toContain('value="tok123"');
  });

  test("a good reset goes to sign-in with a notice; a bad token shows a message", async () => {
    const { resetPasswordAction } = await import("./reset-password/actions");
    const fields = { token: "tok123", password: PASSWORD };
    port.resetPassword.mockResolvedValueOnce(true);
    await expect(resetPasswordAction(null, form(fields))).rejects.toThrow(
      "redirect:/sign-in?reset=1",
    );
    expect(port.resetPassword).toHaveBeenCalledWith("tok123", PASSWORD);
    port.resetPassword.mockResolvedValueOnce(false);
    expect(await resetPasswordAction(null, form(fields))).toEqual({
      message: "That reset link is invalid or has expired.",
    });
  });
});

describe("sign-out", () => {
  test("an account is signed out and sent to sign-in", async () => {
    const { signOutAction } = await import("./actions");
    current.mockResolvedValue(account);
    await expect(signOutAction()).rejects.toThrow("redirect:/sign-in");
    expect(port.signOut).toHaveBeenCalledOnce();
    // Whoever uses this browser next starts their own visit.
    expect(deleteCookie).toHaveBeenCalledWith("iv_visit");
    // And whatever they were reading (P1-W5-S02).
    expect(deleteCookie).toHaveBeenCalledWith("iv_reading");
  });

  test("a guest is never signed out", async () => {
    const { signOutAction } = await import("./actions");
    current.mockResolvedValue(guest);
    await expect(signOutAction()).rejects.toThrow("redirect:/");
    expect(port.signOut).not.toHaveBeenCalled();
  });
});
