import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../server/ports";

const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("./actions", () => ({ join: vi.fn() }));

afterEach(() => {
  current.mockReset();
});

async function render(code?: string): Promise<string> {
  const { default: JoinPage } = await import("./page");
  const searchParams = Promise.resolve(code === undefined ? {} : { code });
  return renderToStaticMarkup(await JoinPage({ searchParams }));
}

test("a visitor with a session is sent home instead of seeing the form", async () => {
  current.mockResolvedValue({
    userId: "u1",
    isGuest: true,
    betaGroup: "student",
  });
  await expect(render("ABCDE-FGHJK")).rejects.toThrow("redirect:/");
});

test("a link's code pre-fills the form", async () => {
  current.mockResolvedValue(null);
  expect(await render("ABCDE-FGHJK")).toContain('value="ABCDE-FGHJK"');
});

// Account first (ADR-0016): one form for the code and the account.
test("the form asks for the code, a name, an email and a password", async () => {
  current.mockResolvedValue(null);
  const html = await render();
  for (const field of ["code", "name", "email", "password"]) {
    expect(html).toContain(`name="${field}"`);
  }
  expect(html).toContain("Create your account with your invite code.");
});
