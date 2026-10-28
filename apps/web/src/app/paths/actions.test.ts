import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Paths } from "../../server/ports";

// §5F, Q-P2-27 (P2-W10-S03): starting a topic path.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const start = vi.fn<Paths["start"]>();
const pause = vi.fn<Paths["pause"]>();
const moveSection = vi.fn<Paths["moveSection"]>();
const skipSection = vi.fn<Paths["skipSection"]>();
const unskipSection = vi.fn<Paths["unskipSection"]>();
const swapSession = vi.fn<Paths["swapSession"]>();
const emit = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  paths: () => ({
    start,
    pause,
    moveSection,
    skipSection,
    unskipSection,
    swapSession,
  }),
  events: () => ({ emit }),
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

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const context = { ...user, sessionId: "visit-1" };

afterEach(() => {
  vi.clearAllMocks();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("starting a path records it once and opens it", async () => {
  const { startPathAction } = await import("./actions");
  current.mockResolvedValue(user);
  start.mockResolvedValue({ firstTime: true, paused: null });
  await expect(startPathAction(form({ pathId: "6" }))).rejects.toThrow(
    "redirect:/paths/6",
  );
  expect(start).toHaveBeenCalledWith("u1", "6");
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith("path_started", { path_id: "6" }, context);
  emit.mockClear();
  start.mockResolvedValue({ firstTime: false, paused: null });
  await expect(startPathAction(form({ pathId: "6" }))).rejects.toThrow(
    "redirect:/paths/6",
  );
  expect(emit).not.toHaveBeenCalled();
});

test("a path that isn't live, or bad input, goes back to the list", async () => {
  const { startPathAction } = await import("./actions");
  current.mockResolvedValue(user);
  start.mockResolvedValue(null);
  await expect(startPathAction(form({ pathId: "6" }))).rejects.toThrow(
    "redirect:/paths",
  );
  start.mockClear();
  await expect(startPathAction(form({ pathId: "x" }))).rejects.toThrow(
    "redirect:/paths",
  );
  expect(start).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test("signed out goes to join", async () => {
  const { startPathAction } = await import("./actions");
  current.mockResolvedValue(null);
  await expect(startPathAction(form({ pathId: "6" }))).rejects.toThrow(
    "redirect:/join",
  );
});

test("a start that pauses another path records that pause (Q-P2-28)", async () => {
  const { startPathAction } = await import("./actions");
  current.mockResolvedValue(user);
  start.mockResolvedValue({ firstTime: true, paused: "4" });
  await expect(startPathAction(form({ pathId: "6" }))).rejects.toThrow(
    "redirect:/paths/6",
  );
  expect(emit).toHaveBeenCalledWith(
    "path_paused",
    { path_id: "4", cause: "started_other" },
    context,
  );
  expect(emit).toHaveBeenCalledWith("path_started", { path_id: "6" }, context);
});

// P2-W10-S05 (C-25, Q-P2-23): edits to the user's copy, back to Edit mode.
test("pause is recorded once; edits go back to Edit mode", async () => {
  const { editPathAction } = await import("./actions");
  current.mockResolvedValue(user);
  pause.mockResolvedValue(true);
  await expect(
    editPathAction(form({ edit: "pause", pathId: "6" })),
  ).rejects.toThrow("redirect:/paths/6?edit=1");
  expect(emit).toHaveBeenCalledWith(
    "path_paused",
    { path_id: "6", cause: "user" },
    context,
  );
  emit.mockClear();
  pause.mockResolvedValue(false);
  await expect(
    editPathAction(form({ edit: "pause", pathId: "6" })),
  ).rejects.toThrow("redirect:/paths/6?edit=1");
  expect(emit).not.toHaveBeenCalled();
  moveSection.mockResolvedValue("6");
  await expect(
    editPathAction(form({ edit: "down", sectionId: "60" })),
  ).rejects.toThrow("redirect:/paths/6?edit=1");
  expect(moveSection).toHaveBeenCalledWith("u1", "60", "down");
  swapSession.mockResolvedValue("6");
  await expect(
    editPathAction(
      form({ edit: "swap", sectionId: "60", ordinal: "1", momentId: "905" }),
    ),
  ).rejects.toThrow("redirect:/paths/6?edit=1");
  expect(swapSession).toHaveBeenCalledWith("u1", "60", 1, "905");
  unskipSection.mockResolvedValue("6");
  await expect(
    editPathAction(form({ edit: "unskip", sectionId: "60" })),
  ).rejects.toThrow("redirect:/paths/6?edit=1");
  expect(emit).not.toHaveBeenCalled();
});

test("a skip is recorded; a refused edit or bad input goes to the list", async () => {
  const { editPathAction } = await import("./actions");
  current.mockResolvedValue(user);
  skipSection.mockResolvedValue("6");
  await expect(
    editPathAction(form({ edit: "skip", sectionId: "60" })),
  ).rejects.toThrow("redirect:/paths/6?edit=1");
  expect(emit).toHaveBeenCalledWith(
    "path_section_skipped",
    { path_id: "6", section_id: "60" },
    context,
  );
  emit.mockClear();
  skipSection.mockResolvedValue(null);
  await expect(
    editPathAction(form({ edit: "skip", sectionId: "60" })),
  ).rejects.toThrow(/^redirect:\/paths$/);
  expect(emit).not.toHaveBeenCalled();
  await expect(
    editPathAction(form({ edit: "delete", sectionId: "60" })),
  ).rejects.toThrow(/^redirect:\/paths$/);
  await expect(
    editPathAction(form({ edit: "swap", sectionId: "60", ordinal: "x" })),
  ).rejects.toThrow(/^redirect:\/paths$/);
});
