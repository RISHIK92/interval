import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../server/ports";

// P2-W11-S01: deleting a PDF book, recorded once (uploads: api/books).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const removeBook = vi.fn();
const finish = vi.fn();
const emit = vi.fn();
const error = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  books: () => ({ finish }),
  jobQueue: () => ({}),
  events: () => ({ emit }),
}));
vi.mock("../../server/books", () => ({ removeBook }));
vi.mock("../../server/log", () => ({ log: { error } }));
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

test("delete removes the user's book once; a file left behind is logged", async () => {
  const { deleteBookAction } = await import("./actions");
  current.mockResolvedValue(user);
  const form = new FormData();
  form.set("bookId", "7");
  removeBook.mockResolvedValueOnce({ removed: true, fileLeft: null });
  await expect(deleteBookAction(form)).rejects.toThrow(
    "redirect:/paths#your-books",
  );
  expect(removeBook).toHaveBeenCalledWith(expect.anything(), "u1", "7");
  expect(emit).toHaveBeenCalledWith("book_deleted", { book_id: "7" }, context);
  emit.mockClear();
  removeBook.mockResolvedValueOnce({
    removed: true,
    fileLeft: { key: "books/u1/x.pdf", error: new Error("s3 down") },
  });
  await expect(deleteBookAction(form)).rejects.toThrow("redirect:");
  expect(error).toHaveBeenCalledWith(
    "books: file not removed",
    expect.objectContaining({ key: "books/u1/x.pdf" }),
  );
  expect(emit).toHaveBeenCalledTimes(1);
  // Not the user's: nothing recorded.
  emit.mockClear();
  removeBook.mockResolvedValueOnce({ removed: false });
  await expect(deleteBookAction(form)).rejects.toThrow("redirect:");
  expect(emit).not.toHaveBeenCalled();
  form.set("bookId", "x");
  await expect(deleteBookAction(form)).rejects.toThrow(/^redirect:\/paths$/);
});

// P2-W11-S04: a session marked done, once, then the next.
test("mark done records once and goes on to the next session, or the list", async () => {
  const { finishSessionAction } = await import("./actions");
  current.mockResolvedValue(user);
  const form = new FormData();
  form.set("sessionId", "71");
  form.set("next", "72");
  finish.mockResolvedValueOnce({ bookId: "7", firstTime: true });
  await expect(finishSessionAction(form)).rejects.toThrow(
    "redirect:/books/7?session=72",
  );
  expect(finish).toHaveBeenCalledWith("u1", "71");
  expect(emit).toHaveBeenCalledWith(
    "book_session_finished",
    { book_id: "7", session_id: "71" },
    context,
  );
  emit.mockClear();
  finish.mockResolvedValueOnce({ bookId: "7", firstTime: false });
  form.delete("next");
  await expect(finishSessionAction(form)).rejects.toThrow(
    "redirect:/paths#your-books",
  );
  expect(emit).not.toHaveBeenCalled();
  finish.mockResolvedValueOnce(null);
  await expect(finishSessionAction(form)).rejects.toThrow(
    "redirect:/paths#your-books",
  );
  expect(emit).not.toHaveBeenCalled();
});
