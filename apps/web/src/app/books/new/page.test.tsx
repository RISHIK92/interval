import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Actor, Entitlements } from "../../../server/ports";

// P2-W11-S01 (Q-P2-34, Q-P2-38): the upload form, its limits and its notice.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const limit = vi.fn<Entitlements["limit"]>((_user, capability) =>
  Promise.resolve(capability === "books.max_mb" ? 50 : 5),
);
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({
    get: () =>
      Promise.resolve({
        goals: [],
        topics: ["backend"],
        level: "beginner",
        breakLength: "3-8",
        firstName: null,
      }),
  }),
  entitlements: () => ({ limit }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

async function page(error?: string): Promise<string> {
  const { default: NewBookPage } = await import("./page");
  return renderToStaticMarkup(
    await NewBookPage({
      searchParams: Promise.resolve(error === undefined ? {} : { error }),
    }),
  );
}

test("the form takes a PDF, says the plan's size limit, and the AI notice", async () => {
  current.mockResolvedValue(user);
  const html = await page();
  expect(html).toMatch(
    /type="file"[^>]*name="file"|name="file"[^>]*type="file"/,
  );
  expect(html).toContain('accept="application/pdf,.pdf"');
  expect(html).toContain("Up to 50 MB");
  expect(html).toContain(
    "Checkpoints send a chapter&#x27;s text to our AI providers to write questions.",
  );
  expect(html).not.toContain('role="alert"');
});

test("a refusal says why, with the plan's numbers", async () => {
  current.mockResolvedValue(user);
  expect(await page("limit")).toContain("You have 5 books, the most for now.");
  expect(await page("too_large")).toContain("That PDF is over 50 MB.");
  expect(await page("not_pdf")).toContain("That file isn&#x27;t a PDF.");
  expect(await page("whatever")).not.toContain('role="alert"');
});

test("signed out goes to join", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/join");
});

// ADR-0029: guests play, and only play; books are for accounts (owner, 2026-10-28).
test("a guest is sent to sign up", async () => {
  current.mockResolvedValue({ ...user, isGuest: true });
  await expect(page()).rejects.toThrow("redirect:/sign-up");
});
