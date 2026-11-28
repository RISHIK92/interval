import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Notes } from "../../server/ports";

// Notes (§5I, Q-P2-01, P2-W7-S03): written from the reader and the Now reading panel,
// on the article (ADR-0058).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const save = vi.fn<Notes["save"]>(() => Promise.resolve(true));
const remove = vi.fn<Notes["remove"]>(() => Promise.resolve(true));
const update = vi.fn<Notes["update"]>(() => Promise.resolve({ itemId: "5" }));
const removeById = vi.fn<Notes["removeById"]>(() =>
  Promise.resolve({ itemId: "5" }),
);
const get = vi.fn<Notes["get"]>(() => Promise.resolve(null));
const bodyById = vi.fn<Notes["bodyById"]>(() => Promise.resolve(null));
const emit = vi.fn();
const warn = vi.fn();
vi.mock("../../server/log", () => ({ log: { warn, info: vi.fn() } }));
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  notes: () => ({ save, remove, update, removeById, get, bodyById }),
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

test("saving writes the trimmed note on the article, counts it by id only, and goes back", async () => {
  current.mockResolvedValue(user);
  const to = await act({
    control: "save",
    itemId: "5",
    // A page from before ADR-0058 may still send its section: the note is the article's.
    momentId: "9",
    body: "  Terms are epochs  ",
    back: "/read/5?from=reader",
  });
  expect(save).toHaveBeenCalledWith("u1", "5", "Terms are epochs");
  expect(emit).toHaveBeenCalledWith("note_saved", { item_id: "5" }, context);
  expect(to).toBe("/read/5?from=reader");
});

test("an empty save deletes the article's note", async () => {
  current.mockResolvedValue(user);
  await act({ control: "save", itemId: "5", body: "   ", back: "/" });
  expect(save).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith("u1", "5");
  expect(emit).toHaveBeenCalledWith("note_deleted", { item_id: "5" }, context);
});

test("deleting a note that isn't there counts nothing", async () => {
  current.mockResolvedValue(user);
  remove.mockResolvedValueOnce(false);
  await act({ control: "delete", itemId: "5", back: "/" });
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
  expect(save).toHaveBeenCalledWith("u1", "5", `${"a".repeat(1998)}\nb`);
});

test("a refused note or a save with nowhere to go is logged, never dropped silently", async () => {
  current.mockResolvedValue(user);
  await act({ control: "save", itemId: "5", body: "a".repeat(2001) });
  expect(warn).toHaveBeenCalledWith("notes: refused input", { user_id: "u1" });
  save.mockResolvedValueOnce(false);
  await act({ control: "save", itemId: "5", body: "kept?" });
  expect(warn).toHaveBeenCalledWith("notes: nothing to attach the note to", {
    user_id: "u1",
    item_id: "5",
  });
  expect(emit).not.toHaveBeenCalled();
});

// ADR-0058: a note joined from section notes may be longer than 2000; it is edited
// up to its own length, never cut, while a shorter note keeps the 2000 limit.
test("a note longer than 2000 is saved up to its own length, by article or by id", async () => {
  current.mockResolvedValue(user);
  const stored = "s".repeat(5000);
  get.mockResolvedValueOnce(stored);
  await act({
    control: "save",
    itemId: "5",
    body: "e".repeat(4999),
    back: "/",
  });
  expect(save).toHaveBeenCalledWith("u1", "5", "e".repeat(4999));
  bodyById.mockResolvedValueOnce(stored);
  await act({
    control: "save",
    noteId: "42",
    body: "e".repeat(5000),
    back: "/",
  });
  expect(bodyById).toHaveBeenCalledWith("u1", "42");
  expect(update).toHaveBeenCalledWith("u1", "42", "e".repeat(5000));
  bodyById.mockResolvedValueOnce(stored);
  await act({
    control: "save",
    noteId: "42",
    body: "e".repeat(5001),
    back: "/",
  });
  expect(update).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith("notes: refused input", { user_id: "u1" });
});

// P2-W7-S04: the Library edits a note by its id.
test("with a note id, saving edits that note and deleting removes it", async () => {
  current.mockResolvedValue(user);
  const to = await act({
    control: "save",
    noteId: "42",
    body: "Still on Raft",
    back: "/library",
  });
  expect(update).toHaveBeenCalledWith("u1", "42", "Still on Raft");
  expect(save).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledWith("note_saved", { item_id: "5" }, context);
  expect(to).toBe("/library");
  await act({ control: "delete", noteId: "42", back: "/library" });
  expect(removeById).toHaveBeenCalledWith("u1", "42");
  expect(emit).toHaveBeenLastCalledWith(
    "note_deleted",
    { item_id: "5" },
    context,
  );
});

test("an empty edit deletes; someone else's note id changes and counts nothing", async () => {
  current.mockResolvedValue(user);
  await act({ control: "save", noteId: "42", body: " ", back: "/library" });
  expect(removeById).toHaveBeenCalledWith("u1", "42");
  vi.clearAllMocks();
  update.mockResolvedValueOnce(null);
  await act({ control: "save", noteId: "7", body: "x", back: "/library" });
  expect(emit).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith("notes: no such note", {
    user_id: "u1",
    note_id: "7",
  });
  expect(await act({ control: "save", noteId: "x", body: "a" })).toBe("/");
});

// ADR-0029: guests play, and only play; this action is for accounts.
test("a guest is sent to sign up before anything is written", async () => {
  current.mockResolvedValue({ ...user, isGuest: true });
  const all = await import("./actions");
  await expect(all.noteAction(new FormData())).rejects.toThrow(
    "redirect:/sign-up",
  );
});
