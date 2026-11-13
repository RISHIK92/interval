import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, AdminDisputes } from "../../../server/ports";

// P5-W35 (Q-P5-22): disputed battle results, for admin.review only, with the rate.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const pending = vi.fn<AdminDisputes["pending"]>();
const rate = vi.fn<AdminDisputes["rate"]>();
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminDisputes: () => ({ pending, rate }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const admin: Actor = { userId: "a1", isGuest: false, betaGroup: "developer" };

afterEach(() => {
  vi.clearAllMocks();
});

async function page(): Promise<string> {
  const { default: DisputesPage } = await import("./page");
  return renderToStaticMarkup(
    await DisputesPage({ searchParams: Promise.resolve({}) }),
  );
}

test("only admin.review sees it", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
});

test("each dispute with its reason, and the rate against the 3% goal", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  rate.mockResolvedValue({ finished: 40, disputed: 1 });
  pending.mockResolvedValue([
    {
      matchId: "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b",
      userId: "u2",
      player: "bob_b",
      reason: "The judge timed out on a correct answer.",
      createdAt: new Date("2026-11-14T10:00:00Z"),
    },
  ]);
  const html = await page();
  expect(html).toContain("1 of 40 finished battles disputed");
  expect(html).toContain("2.5%");
  expect(html).toContain("bob_b");
  expect(html).toContain("The judge timed out on a correct answer.");
  expect(html).toContain('value="upheld"');
});
