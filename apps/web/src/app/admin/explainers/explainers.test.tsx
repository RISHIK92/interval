import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  AdminExplainers,
  AdminScenes,
  ExplainerReview,
  FileStore,
  PendingScene,
} from "../../../server/ports";

// P4-W22-S01 (§5G, AI-1, AI-3, Q-P4-11): explainer scripts, for admin.review only: each
// labeled as AI, its sources as deep links, approved or rejected before voicing.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const pending = vi.fn<AdminExplainers["pending"]>(() => Promise.resolve([]));
const decide = vi.fn<AdminExplainers["decide"]>(() => Promise.resolve(true));
const scenesPending = vi.fn<AdminScenes["pending"]>(() => Promise.resolve([]));
const scene = vi.fn<AdminScenes["scene"]>(() => Promise.resolve(null));
const decideScene = vi.fn<AdminScenes["decide"]>(() => Promise.resolve(true));
const media: Record<string, string> = {};
const get = vi.fn<FileStore["get"]>((key) => {
  const text = media[key];
  return Promise.resolve(
    text === undefined
      ? null
      : { body: new Blob([text]).stream(), etag: null, size: null },
  );
});
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminExplainers: () => ({ pending, decide }),
  adminScenes: () => ({
    pending: scenesPending,
    scene,
    decide: decideScene,
  }),
  mediaFiles: () => ({ get }),
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

// P4.5-W26-S02 (AI-1, Q-P4.5-03): drafted scene timelines, drawn from the media bucket,
// checked by every rule before the owner can approve one.
const timeline = {
  diagram: {
    title: "Leader election",
    shapes: [
      { id: "a", kind: "service", label: "Node A", at: { col: 0, row: 0 } },
    ],
    arrows: [],
  },
  steps: [{ at: 1, show: ["a"], describe: "One node waits." }],
};
const drawn: PendingScene = {
  id: "11",
  concept: "Leader election",
  key: "media/explainers/3/7/scenes/a.json",
  model: "qwen/x",
  captions: [
    { text: "Raft", start: 0, end: 0.4 },
    { text: "waits.", start: 0.4, end: 1 },
  ],
};

test("a pending timeline is drawn, labeled AI, with its first step and captions", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  media[drawn.key] = JSON.stringify(timeline);
  scenesPending.mockResolvedValue([drawn]);
  const html = await page();
  expect(html).toContain("Timelines");
  expect(html).toContain("Leader election");
  expect(html).toContain("AI-drafted");
  expect(html).toContain("One node waits.");
  expect(html).toContain("<mark>waits.</mark>");
  expect(html).toContain("Drawn by qwen/x");
  expect(html).toContain('value="approved"');
});

test("a timeline that breaks a rule lists why and can only be rejected", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  media[drawn.key] = JSON.stringify(timeline);
  scenesPending.mockResolvedValue([{ ...drawn, captions: [] }]);
  const html = await page();
  expect(html).toContain(
    "A step is anchored past the explainer&#x27;s last caption word.",
  );
  expect(html).not.toContain('value="approved"');
  expect(html).toContain('value="rejected"');
});

test("approval re-checks the timeline; reject needs no file; decided says so", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  media[drawn.key] = JSON.stringify(timeline);
  scene.mockResolvedValue(drawn);
  const { decideSceneAction } = await import("./actions");
  await expect(
    decideSceneAction(form({ sceneId: "11", decision: "approved" })),
  ).rejects.toThrow("redirect:/admin/explainers?saved=1");
  expect(decideScene).toHaveBeenCalledWith("11", "approved", "a1");

  decideScene.mockClear();
  scene.mockResolvedValue({ ...drawn, captions: [] });
  await expect(
    decideSceneAction(form({ sceneId: "11", decision: "approved" })),
  ).rejects.toThrow("redirect:/admin/explainers?error=scene");
  expect(decideScene).not.toHaveBeenCalled();

  get.mockClear();
  await expect(
    decideSceneAction(form({ sceneId: "11", decision: "rejected" })),
  ).rejects.toThrow("redirect:/admin/explainers?saved=1");
  expect(get).not.toHaveBeenCalled();

  scene.mockResolvedValue(null);
  await expect(
    decideSceneAction(form({ sceneId: "11", decision: "approved" })),
  ).rejects.toThrow("redirect:/admin/explainers?error=decided");
  decideScene.mockResolvedValueOnce(false);
  await expect(
    decideSceneAction(form({ sceneId: "11", decision: "rejected" })),
  ).rejects.toThrow("redirect:/admin/explainers?error=decided");
  await expect(
    decideSceneAction(form({ sceneId: "x", decision: "approved" })),
  ).rejects.toThrow("notFound");
});

test("anyone without admin.review can't decide a timeline", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  const { decideSceneAction } = await import("./actions");
  await expect(
    decideSceneAction(form({ sceneId: "11", decision: "approved" })),
  ).rejects.toThrow("notFound");
  expect(decideScene).not.toHaveBeenCalled();
});
