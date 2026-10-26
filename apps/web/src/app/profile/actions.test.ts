import { afterEach, describe, expect, test, vi } from "vitest";
import type { Actor, Feedback, PreferencesStore } from "../../server/ports";

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
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

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
  current.mockResolvedValue(guest);
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
