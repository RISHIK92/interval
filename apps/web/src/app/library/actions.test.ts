import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Feedback } from "../../server/ports";

const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const unsave = vi.fn<Feedback["unsave"]>(() => Promise.resolve(true));
const enqueue = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  feedback: () => ({ unsave }),
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

function form(itemId: string): FormData {
  const data = new FormData();
  data.set("itemId", itemId);
  return data;
}

test("unsave from the Library returns to the Library and queues a recompute", async () => {
  const { libraryUnsaveAction } = await import("./actions");
  current.mockResolvedValue(guest);
  await expect(libraryUnsaveAction(form("7"))).rejects.toThrow(
    /^redirect:\/library$/,
  );
  expect(unsave).toHaveBeenCalledExactlyOnceWith("g1", "7");
  expect(enqueue).toHaveBeenCalledOnce();
  unsave.mockResolvedValueOnce(false);
  enqueue.mockClear();
  await expect(libraryUnsaveAction(form("7"))).rejects.toThrow("redirect:");
  expect(enqueue).not.toHaveBeenCalled();
});

test("a bad id or no session changes nothing", async () => {
  const { libraryUnsaveAction } = await import("./actions");
  current.mockResolvedValue(guest);
  await expect(libraryUnsaveAction(form("7x"))).rejects.toThrow(
    /^redirect:\/library$/,
  );
  current.mockResolvedValue(null);
  await expect(libraryUnsaveAction(form("7"))).rejects.toThrow(
    "redirect:/join",
  );
  expect(unsave).not.toHaveBeenCalled();
});
