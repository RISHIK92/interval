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

// ADR-0056: an old invite link's code rides along hidden and still sets its group.
test("a link's code is kept, hidden, for the submit", async () => {
  current.mockResolvedValue(null);
  const html = await render("ABCDE-FGHJK");
  expect(html).toContain('type="hidden" name="code" value="ABCDE-FGHJK"');
});

// Account first (ADR-0016), open to anyone (ADR-0056): no code to enter.
test("the form asks for a name, an email and a password, and no code", async () => {
  current.mockResolvedValue(null);
  const html = await render();
  for (const field of ["name", "email", "password"]) {
    expect(html).toContain(`name="${field}"`);
  }
  expect(html).not.toContain('name="code"');
  expect(html).not.toMatch(/invite|private beta/i);
});
