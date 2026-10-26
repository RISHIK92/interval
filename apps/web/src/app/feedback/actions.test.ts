import { afterEach, describe, expect, test, vi } from "vitest";
import type { Actor, Feedback } from "../../server/ports";

// §5C, Q-P1-15, P1-W4-S07: each control records its feedback, emits its event and
// queues a recompute; none touches the user's explicit choices (PER-1).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const port = {
  give: vi.fn<Feedback["give"]>(() => Promise.resolve(true)),
  undoNotInterested: vi.fn<Feedback["undoNotInterested"]>(() =>
    Promise.resolve(true),
  ),
  hideSource: vi.fn<Feedback["hideSource"]>(() => Promise.resolve(true)),
  save: vi.fn<Feedback["save"]>(() => Promise.resolve(true)),
  unsave: vi.fn<Feedback["unsave"]>(() => Promise.resolve(true)),
  notInterested: vi.fn<Feedback["notInterested"]>(),
};
const emit = vi.fn();
const enqueue = vi.fn<() => Promise<void>>(() => Promise.resolve());
const preferenceCalls = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  feedback: () => port,
  events: () => ({ emit }),
  jobQueue: () => ({ enqueue }),
  // Any use of the explicit choices would show up here.
  preferences: () => ({
    get: preferenceCalls,
    createIfAbsent: preferenceCalls,
  }),
}));
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

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };
const context = { ...guest, sessionId: "visit-1" };

afterEach(() => {
  vi.clearAllMocks();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function press(control: string, itemId = "42", chip = "3-8") {
  const { feedbackAction } = await import("./actions");
  current.mockResolvedValue(guest);
  return feedbackAction(form({ control, itemId, chip }));
}

describe("each control", () => {
  test.each([
    ["more_like_this", "/?chip=3-8"],
    ["less_like_this", "/?chip=3-8"],
    ["not_interested", "/?chip=3-8&undo=42"],
  ] as const)("%s records feedback and goes to %s", async (kind, target) => {
    await expect(press(kind)).rejects.toThrow(`redirect:${target}`);
    expect(port.give).toHaveBeenCalledExactlyOnceWith("g1", "42", kind);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "feedback_given",
      { kind },
      context,
    );
  });

  test("hide source hides the item's source", async () => {
    await expect(press("hide_source")).rejects.toThrow("redirect:/?chip=3-8");
    expect(port.hideSource).toHaveBeenCalledExactlyOnceWith("g1", "42");
    expect(emit).toHaveBeenCalledExactlyOnceWith("source_hidden", {}, context);
  });

  test("save stores the item", async () => {
    await expect(press("save", "42", "8-15")).rejects.toThrow(
      "redirect:/?chip=8-15",
    );
    expect(port.save).toHaveBeenCalledExactlyOnceWith("g1", "42");
    expect(emit).toHaveBeenCalledExactlyOnceWith("item_saved", {}, context);
  });

  test("undo removes only the not-interested record", async () => {
    await expect(press("undo_not_interested")).rejects.toThrow(
      "redirect:/?chip=3-8",
    );
    expect(port.undoNotInterested).toHaveBeenCalledExactlyOnceWith("g1", "42");
    expect(port.give).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "feedback_undone",
      { kind: "not_interested" },
      context,
    );
  });

  test.each([
    "more_like_this",
    "less_like_this",
    "not_interested",
    "hide_source",
    "save",
    "undo_not_interested",
  ])(
    "%s queues a recompute and leaves explicit choices alone",
    async (control) => {
      await expect(press(control)).rejects.toThrow("redirect:");
      expect(enqueue).toHaveBeenCalledOnce();
      expect(enqueue.mock.calls[0]).toEqual([
        "recompute_feed",
        { user_id: "g1" },
        { idempotencyKey: expect.stringMatching(/^feedback-g1-/) as string },
      ]);
      expect(preferenceCalls).not.toHaveBeenCalled();
    },
  );
});

test("a repeat changes nothing: no event, no recompute", async () => {
  port.give.mockResolvedValueOnce(false);
  await expect(press("more_like_this")).rejects.toThrow("redirect:/?chip=3-8");
  expect(emit).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
});

test("a queue failure is logged and the feedback still counts (LOAD-5)", async () => {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  enqueue.mockRejectedValueOnce(new Error("valkey down"));
  await expect(press("not_interested")).rejects.toThrow(
    "redirect:/?chip=3-8&undo=42",
  );
  expect(port.give).toHaveBeenCalledOnce();
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "feedback_given",
    { kind: "not_interested" },
    context,
  );
  expect(lines.join("")).toContain("feed: recompute after feedback not queued");
});

test.each([
  ["an unknown control", { control: "delete_all", itemId: "42", chip: "3-8" }],
  ["a bad item id", { control: "save", itemId: "42; drop", chip: "3-8" }],
])("%s is refused without a write", async (_name, fields) => {
  const { feedbackAction } = await import("./actions");
  current.mockResolvedValue(guest);
  await expect(feedbackAction(form(fields))).rejects.toThrow(/^redirect:\/$/);
  expect(port.give).not.toHaveBeenCalled();
  expect(port.save).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test("without a session the visitor is sent to /join", async () => {
  const { feedbackAction } = await import("./actions");
  current.mockResolvedValue(null);
  await expect(
    feedbackAction(form({ control: "save", itemId: "42", chip: "3-8" })),
  ).rejects.toThrow("redirect:/join");
  expect(port.save).not.toHaveBeenCalled();
});

test("Saved ✓ unsaves, queues a recompute and counts no event", async () => {
  await expect(press("unsave")).rejects.toThrow("redirect:/?chip=3-8");
  expect(port.unsave).toHaveBeenCalledExactlyOnceWith("g1", "42");
  expect(enqueue).toHaveBeenCalledOnce();
  expect(emit).not.toHaveBeenCalled();
});

test("an unsave that changes nothing queues nothing", async () => {
  port.unsave.mockResolvedValueOnce(false);
  await expect(press("unsave")).rejects.toThrow("redirect:/?chip=3-8");
  expect(enqueue).not.toHaveBeenCalled();
});
