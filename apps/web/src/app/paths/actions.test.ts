import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Paths } from "../../server/ports";

// §5F, Q-P2-27 (P2-W10-S03): starting a topic path.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const start = vi.fn<Paths["start"]>();
const emit = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  paths: () => ({ start }),
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
  start.mockResolvedValue(true);
  await expect(startPathAction(form({ pathId: "6" }))).rejects.toThrow(
    "redirect:/paths/6",
  );
  expect(start).toHaveBeenCalledWith("u1", "6");
  expect(emit).toHaveBeenCalledWith("path_started", { path_id: "6" }, context);
  emit.mockClear();
  start.mockResolvedValue(false);
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
