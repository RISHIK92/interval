import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  Actor,
  Feedback,
  GitHubAccounts,
  PreferencesStore,
} from "../../server/ports";

// §5A, PER-1, Q-P1-36, P1-W4-S08: the Profile page's three actions.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const update = vi.fn<PreferencesStore["update"]>(() => Promise.resolve(true));
const resetInferred = vi.fn<Feedback["resetInferred"]>(() => Promise.resolve());
const unhideSource = vi.fn<Feedback["unhideSource"]>(() =>
  Promise.resolve(true),
);
const give = vi.fn();
const enqueue = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ update }),
  feedback: () => ({ resetInferred, unhideSource, give }),
  jobQueue: () => ({ enqueue }),
  githubAccounts: () => ({ disconnect, get: githubGet }),
  events: () => ({ emit }),
}));
const disconnect = vi.fn<GitHubAccounts["disconnect"]>(() =>
  Promise.resolve(true),
);
const emit = vi.fn();
const githubGet = vi.fn<GitHubAccounts["get"]>(() =>
  Promise.resolve({
    login: "octo",
    connectedAt: new Date(),
    installations: [],
    syncedMinutesAgo: null,
    repositories: [],
  }),
);
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const user: Actor = { userId: "g1", isGuest: false, betaGroup: "student" };
const guest: Actor = { ...user, isGuest: true };

afterEach(() => {
  vi.clearAllMocks();
});

// A goal unless the test gives its own (ADR-0015 needs one).
function form(fields: [string, string][]): FormData {
  const data = new FormData();
  const withGoal: [string, string][] = fields.some(([name]) => name === "goal")
    ? fields
    : [["goal", "system-design-interviews"], ...fields];
  for (const [name, value] of withGoal) data.append(name, value);
  return data;
}

async function actions() {
  current.mockResolvedValue(user);
  return import("./actions");
}

describe("editing the explicit choices", () => {
  test("replaces them, queues a recompute, and touches no feedback", async () => {
    const { updatePreferencesAction } = await actions();
    await expect(
      updatePreferencesAction(
        form([
          ["topic", "backend"],
          ["topic", "databases"],
          ["level", "advanced"],
          ["breakLength", "8-15"],
        ]),
      ),
    ).rejects.toThrow("redirect:/profile?saved=choices");
    expect(update).toHaveBeenCalledExactlyOnceWith("g1", {
      goals: ["system-design-interviews"],
      topics: ["backend", "databases"],
      level: "advanced",
      breakLength: "8-15",
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(give).not.toHaveBeenCalled();
    expect(resetInferred).not.toHaveBeenCalled();
  });

  test("before onboarding there is nothing to edit: off to onboarding", async () => {
    const { updatePreferencesAction } = await actions();
    update.mockResolvedValueOnce(false);
    await expect(
      updatePreferencesAction(
        form([
          ["topic", "backend"],
          ["level", "advanced"],
          ["breakLength", "8-15"],
        ]),
      ),
    ).rejects.toThrow("redirect:/onboarding");
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("an edit with no topic is refused and changes nothing", async () => {
    const { updatePreferencesAction } = await actions();
    await expect(
      updatePreferencesAction(
        form([
          ["level", "advanced"],
          ["breakLength", "8-15"],
        ]),
      ),
    ).rejects.toThrow("redirect:/profile?missing=topic");
    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

test("reset clears the inferred layer and never the explicit choices", async () => {
  const { resetInferredAction } = await actions();
  await expect(resetInferredAction()).rejects.toThrow(
    "redirect:/profile?saved=reset",
  );
  expect(resetInferred).toHaveBeenCalledExactlyOnceWith("g1");
  expect(update).not.toHaveBeenCalled();
  expect(enqueue).toHaveBeenCalledOnce();
});

test("unhide restores one source on the next recompute", async () => {
  const { unhideSourceAction } = await actions();
  await expect(unhideSourceAction(form([["sourceId", "7"]]))).rejects.toThrow(
    "redirect:/profile?saved=unhidden",
  );
  expect(unhideSource).toHaveBeenCalledExactlyOnceWith("g1", "7");
  expect(enqueue).toHaveBeenCalledOnce();
  expect(enqueue.mock.calls[0]?.[0]).toBe("recompute_feed");
});

test("a malformed source id is refused", async () => {
  const { unhideSourceAction } = await actions();
  await expect(
    unhideSourceAction(form([["sourceId", "7 or 1=1"]])),
  ).rejects.toThrow(/^redirect:\/profile$/);
  expect(unhideSource).not.toHaveBeenCalled();
});

test("without a session every action sends the visitor to /join", async () => {
  const all = await import("./actions");
  current.mockResolvedValue(null);
  const valid = form([
    ["topic", "backend"],
    ["level", "advanced"],
    ["breakLength", "8-15"],
    ["sourceId", "7"],
  ]);
  await expect(all.updatePreferencesAction(valid)).rejects.toThrow(
    "redirect:/join",
  );
  await expect(all.resetInferredAction()).rejects.toThrow("redirect:/join");
  await expect(all.unhideSourceAction(valid)).rejects.toThrow("redirect:/join");
  expect(update).not.toHaveBeenCalled();
  expect(resetInferred).not.toHaveBeenCalled();
  expect(unhideSource).not.toHaveBeenCalled();
});

// P2-W12-S01 (§5H, ADR-0024): disconnecting deletes Interval's copy, recorded once.
test("disconnect deletes the user's GitHub connection and says how to revoke on GitHub", async () => {
  const { disconnectGitHubAction } = await import("./actions");
  current.mockResolvedValue(user);
  await expect(disconnectGitHubAction()).rejects.toThrow(
    "redirect:/profile?saved=github-off",
  );
  expect(disconnect).toHaveBeenCalledWith("g1");
  expect(emit).toHaveBeenCalledWith(
    "github_disconnected",
    {},
    expect.objectContaining({ userId: "g1", sessionId: "visit-1" }),
  );
  // P2-W12-S04: the feed drops its project picks on the recompute.
  expect(enqueue).toHaveBeenCalledWith(
    "recompute_feed",
    { user_id: "g1" },
    expect.anything(),
  );
  // Nothing was connected: nothing recorded.
  emit.mockClear();
  disconnect.mockResolvedValueOnce(false);
  await expect(disconnectGitHubAction()).rejects.toThrow("redirect:/profile");
  expect(emit).not.toHaveBeenCalled();
});

test("refresh queues a read of the user's repositories, one a minute", async () => {
  const { refreshGitHubAction } = await import("./actions");
  current.mockResolvedValue(user);
  await expect(refreshGitHubAction()).rejects.toThrow(
    "redirect:/profile?saved=github-refresh",
  );
  expect(enqueue).toHaveBeenCalledWith(
    "github_sync",
    { user_id: "g1" },
    {
      idempotencyKey: expect.stringMatching(/^github-sync-g1-m\d+$/) as unknown,
    },
  );
});

test("refresh does nothing for someone not connected, and says so when the queue is down", async () => {
  const { refreshGitHubAction } = await import("./actions");
  current.mockResolvedValue(user);
  githubGet.mockResolvedValueOnce(null);
  await expect(refreshGitHubAction()).rejects.toThrow("redirect:/profile");
  expect(enqueue).not.toHaveBeenCalled();
  enqueue.mockRejectedValueOnce(new Error("valkey down"));
  await expect(refreshGitHubAction()).rejects.toThrow(
    "redirect:/profile?github=refresh-failed",
  );
});

// ADR-0029: guests play, and only play; this action is for accounts.
test("a guest is sent to sign up before anything is written", async () => {
  current.mockResolvedValue(guest);
  const all = await import("./actions");
  await expect(all.updatePreferencesAction(new FormData())).rejects.toThrow(
    "redirect:/sign-up",
  );
  await expect(all.resetInferredAction()).rejects.toThrow("redirect:/sign-up");
  await expect(all.unhideSourceAction(new FormData())).rejects.toThrow(
    "redirect:/sign-up",
  );
  await expect(all.refreshGitHubAction()).rejects.toThrow("redirect:/sign-up");
  await expect(all.disconnectGitHubAction()).rejects.toThrow(
    "redirect:/sign-up",
  );
});
