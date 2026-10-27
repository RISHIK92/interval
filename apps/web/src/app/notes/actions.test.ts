import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Notes } from "../../server/ports";

// Notes (§5I, Q-P2-01, P2-W7-S03): written from the reader and the Now reading panel.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const save = vi.fn<Notes["save"]>(() => Promise.resolve(true));
const remove = vi.fn<Notes["remove"]>(() => Promise.resolve(true));
const emit = vi.fn();
const warn = vi.fn();
vi.mock("../../server/log", () => ({ log: { warn, info: vi.fn() } }));
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  notes: () => ({ save, remove }),
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
vi.mock("../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "developer" };
const context = { ...user, sessionId: "visit-1" };

afterEach(() => {
  vi.clearAllMocks();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function act(fields: Record<string, string>): Promise<string> {
  const { noteAction } = await import("./actions");
  try {
    await noteAction(form(fields));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) {
      return error.message.slice("redirect:".length);
    }
    throw error;
  }
  throw new Error("no redirect");
}

test("saving writes the trimmed note, counts it by ids only, and goes back", async () => {
  current.mockResolvedValue(user);
  const to = await act({
    control: "save",
    itemId: "5",
    momentId: "9",
    body: "  Terms are epochs  ",
    back: "/read/5?moment=9&chip=3-8&from=reader",
  });
  expect(save).toHaveBeenCalledWith("u1", "5", "9", "Terms are epochs");
  expect(emit).toHaveBeenCalledWith(
    "note_saved",
    { item_id: "5", moment_id: "9" },
    context,
  );
  expect(to).toBe("/read/5?moment=9&chip=3-8&from=reader");
});

test("an article's note has no moment; an empty save deletes it", async () => {
  current.mockResolvedValue(user);
  await act({ control: "save", itemId: "5", body: "   ", back: "/" });
  expect(save).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith("u1", "5", null);
  expect(emit).toHaveBeenCalledWith(
    "note_deleted",
    { item_id: "5", moment_id: null },
    context,
  );
});

test("deleting a note that isn't there counts nothing", async () => {
  current.mockResolvedValue(user);
  remove.mockResolvedValueOnce(false);
  await act({ control: "delete", itemId: "5", momentId: "9", back: "/" });
  expect(emit).not.toHaveBeenCalled();
});

test("bad input, a too-long note, another site's back link, or no session go nowhere harmful", async () => {
  current.mockResolvedValue(user);
  expect(await act({ control: "save", itemId: "x", body: "a" })).toBe("/");
  expect(
    await act({ control: "save", itemId: "5", body: "a".repeat(2001) }),
  ).toBe("/");
  expect(save).not.toHaveBeenCalled();
  expect(
    await act({
      control: "save",
      itemId: "5",
      body: "a",
      back: "https://evil.example/",
    }),
  ).toBe("/");
  current.mockResolvedValue(null);
  expect(await act({ control: "save", itemId: "5", body: "a" })).toBe("/join");
});

test("newlines count once, as the text area counts them, and are kept as \\n", async () => {
  current.mockResolvedValue(user);
  // Browsers send a text area's newlines as CRLF; its maxLength counts one character.
  const atLimit = `${"a".repeat(1998)}\r\nb`;
  await act({ control: "save", itemId: "5", body: atLimit, back: "/" });
  expect(save).toHaveBeenCalledWith("u1", "5", null, `${"a".repeat(1998)}\nb`);
});

test("a refused note or a save with nowhere to go is logged, never dropped silently", async () => {
  current.mockResolvedValue(user);
  await act({ control: "save", itemId: "5", body: "a".repeat(2001) });
  expect(warn).toHaveBeenCalledWith("notes: refused input", { user_id: "u1" });
  save.mockResolvedValueOnce(false);
  await act({ control: "save", itemId: "5", momentId: "9", body: "kept?" });
  expect(warn).toHaveBeenCalledWith("notes: nothing to attach the note to", {
    user_id: "u1",
    item_id: "5",
    moment_id: "9",
  });
  expect(emit).not.toHaveBeenCalled();
});
