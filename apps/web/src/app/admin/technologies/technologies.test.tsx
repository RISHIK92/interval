import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  AdminTechnologies,
  TechnologySuggestionRow,
} from "../../../server/ports";

// P2-W12-S03 (PER-4, AI-3): suggested technologies, for admin.review only.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const pending = vi.fn<AdminTechnologies["pending"]>(() => Promise.resolve([]));
const unclaimed = vi.fn<AdminTechnologies["unclaimed"]>(() =>
  Promise.resolve([]),
);
const coverage = vi.fn<AdminTechnologies["coverage"]>(() =>
  Promise.resolve({
    technologies: 61,
    packages: 140,
    dependencies: 116,
    resolved: 65,
  }),
);
const accept = vi.fn<AdminTechnologies["accept"]>(() =>
  Promise.resolve("accepted" as const),
);
const reject = vi.fn<AdminTechnologies["reject"]>(() => Promise.resolve(true));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminTechnologies: () => ({ pending, unclaimed, coverage, accept, reject }),
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
const knex: TechnologySuggestionRow = {
  id: "5",
  ecosystem: "npm",
  package: "knex",
  users: 3,
  name: "Knex",
  slug: "knex",
  concepts: [
    { slug: "transactions", name: "Transactions" },
    { slug: "schema-migrations", name: "Schema migrations" },
  ],
  model: "qmodel",
};

afterEach(() => {
  vi.clearAllMocks();
});

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: TechnologiesPage } = await import("./page");
  return renderToStaticMarkup(
    await TechnologiesPage({ searchParams: Promise.resolve(query) }),
  );
}

test("only admin.review sees the page", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("notFound");
});

test("pending suggestions with their concepts, labeled as AI, then unclaimed packages and coverage", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  pending.mockResolvedValueOnce([knex]);
  unclaimed.mockResolvedValueOnce([
    { ecosystem: "go", package: "github.com/google/uuid", users: 2 },
  ]);
  const html = await page();
  expect(html).toContain("knex");
  expect(html).toContain("Knex");
  expect(html).toContain("Transactions, Schema migrations");
  expect(html).toContain("AI suggestion · qmodel");
  expect(html).toMatch(
    /name="suggestionId" value="5"[^]*?value="accept"[^>]*name="decision"[^]*?Accept/,
  );
  expect(html).toContain("github.com/google/uuid");
  expect(html).toContain("65 of 116 dependency names resolve");
});

test("accept and reject check access, and say when it was already decided", async () => {
  const { decideTechnologyAction } = await import("./actions");
  const form = (decision: string, id = "5") => {
    const data = new FormData();
    data.set("suggestionId", id);
    data.set("decision", decision);
    return data;
  };
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  await expect(decideTechnologyAction(form("accept"))).rejects.toThrow(
    "redirect:/admin/technologies?saved=1",
  );
  expect(accept).toHaveBeenCalledWith("5", "a1");
  reject.mockResolvedValueOnce(false);
  await expect(decideTechnologyAction(form("reject"))).rejects.toThrow(
    "redirect:/admin/technologies?error=decided",
  );
  await expect(decideTechnologyAction(form("delete"))).rejects.toThrow(
    "notFound",
  );
  await expect(decideTechnologyAction(form("accept", "x"))).rejects.toThrow(
    "notFound",
  );
  can.mockResolvedValue(false);
  await expect(decideTechnologyAction(form("accept"))).rejects.toThrow(
    "notFound",
  );
});
