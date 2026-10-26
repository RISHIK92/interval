import { afterEach, expect, test, vi } from "vitest";

// The device's theme (owner, 2026-10-26): a cookie on this device, no account data.
const set = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

test("a choice is kept for a year on this device, then back to the page", async () => {
  const { setThemeAction } = await import("./actions");
  await expect(
    setThemeAction(form({ theme: "dark", back: "/profile" })),
  ).rejects.toThrow("redirect:/profile");
  expect(set).toHaveBeenCalledExactlyOnceWith(
    "iv_theme",
    "dark",
    expect.objectContaining({
      maxAge: 365 * 24 * 60 * 60,
      sameSite: "lax",
      path: "/",
      httpOnly: true,
    }),
  );
});

test.each([
  "https://evil.test/",
  "//evil.test",
  "/\t/evil.test",
  "/\n/evil.test",
  "/\r\\evil.test",
  "/\\evil.test",
  "",
])("back %j never leaves the site", async (back) => {
  const { setThemeAction } = await import("./actions");
  await expect(setThemeAction(form({ theme: "light", back }))).rejects.toThrow(
    "redirect:/",
  );
});

test("an unknown theme falls back to the device's own", async () => {
  const { setThemeAction } = await import("./actions");
  await expect(
    setThemeAction(form({ theme: "neon", back: "/" })),
  ).rejects.toThrow("redirect:/");
  expect(set).toHaveBeenCalledWith("iv_theme", "system", expect.anything());
});
