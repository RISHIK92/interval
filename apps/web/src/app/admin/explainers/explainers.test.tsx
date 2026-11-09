import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  AdminExplainers,
  ExplainerReview,
} from "../../../server/ports";

// P4-W22-S01 (§5G, AI-1, AI-3, Q-P4-11): explainer scripts, for admin.review only: each
// labeled as AI, its sources as deep links, approved or rejected before voicing.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const pending = vi.fn<AdminExplainers["pending"]>(() => Promise.resolve([]));
const decide = vi.fn<AdminExplainers["decide"]>(() => Promise.resolve(true));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminExplainers: () => ({ pending, decide }),
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
const consensus: ExplainerReview = {
  id: "7",
  concept: "Consensus",
  script: "Consensus keeps replicas agreeing about one history.",
  model: "qwen/x",
  createdAt: new Date("2026-11-09T12:00:00Z"),
  missing: 0,
  citations: [
    {
      momentId: "9",
      articleTitle: "Raft",
      sectionTitle: "Elections",
      link: "https://blog.test/raft#elections",
    },
    {
      momentId: "10",
      articleTitle: "Paxos",
      sectionTitle: "Basics",
      link: "https://blog.test/paxos#basics",
    },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
});

const page = async (query: Record<string, string> = {}) => {
  const { default: ExplainersPage } = await import("./page");
  return renderToStaticMarkup(
    await ExplainersPage({ searchParams: Promise.resolve(query) }),
  );
};
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

test("pending scripts, labeled AI-drafted, with their sources as deep links", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  pending.mockResolvedValue([consensus]);
  const html = await page();
  expect(html).toContain("Consensus");
  expect(html).toContain("AI-drafted");
  expect(html).toContain(consensus.script);
  expect(html).toContain('href="https://blog.test/raft#elections"');
  expect(html).toContain("Raft: Elections");
  expect(html).toContain("Approve");
  expect(html).toContain("Reject");
});

test("a script left with one source says so and can only be rejected (AI-1)", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  pending.mockResolvedValue([
    { ...consensus, missing: 1, citations: consensus.citations.slice(0, 1) },
  ]);
  const html = await page();
  expect(html).toContain("1 cited section is gone since it was written.");
  expect(html).not.toContain("Approve");
  expect(html).toContain("Reject");
});

test("approve and reject are recorded by whom; a decided one says so", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { decideExplainerAction } = await import("./actions");
  await expect(
    decideExplainerAction(form({ explainerId: "7", decision: "approved" })),
  ).rejects.toThrow("redirect:/admin/explainers?saved=1");
  expect(decide).toHaveBeenCalledWith("7", "approved", "a1");
  decide.mockResolvedValueOnce(false);
  await expect(
    decideExplainerAction(form({ explainerId: "7", decision: "rejected" })),
  ).rejects.toThrow("redirect:/admin/explainers?error=decided");
  await expect(
    decideExplainerAction(form({ explainerId: "7", decision: "voice" })),
  ).rejects.toThrow("notFound");
});

test("anyone without admin.review finds nothing, page or action", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  const { decideExplainerAction } = await import("./actions");
  await expect(
    decideExplainerAction(form({ explainerId: "7", decision: "approved" })),
  ).rejects.toThrow("notFound");
  expect(decide).not.toHaveBeenCalled();
});
