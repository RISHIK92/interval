import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../server/ports";

// P2-W11-S01 (Q-P2-34, Q-P2-37): the upload, checked before its body is read.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const addBook = vi.fn();
const emit = vi.fn();
const limit = vi.fn(() => Promise.resolve(50));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  books: () => ({}),
  files: () => ({}),
  jobQueue: () => ({}),
  entitlements: () => ({ limit }),
  events: () => ({ emit }),
}));
vi.mock("../../../server/books", () => ({ addBook }));
vi.mock("../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

function post(
  body: FormData | null,
  headers: Record<string, string> = {},
): Request {
  const request = new Request("http://localhost:3100/api/books", {
    method: "POST",
    headers: { origin: "http://localhost:3100", ...headers },
    ...(body === null ? {} : { body }),
  });
  return request;
}

function pdf(): FormData {
  const form = new FormData();
  form.set(
    "file",
    new File(["%PDF-1.7"], "ddia.pdf", { type: "application/pdf" }),
  );
  return form;
}

async function location(request: Request): Promise<string | null> {
  const { POST } = await import("./route");
  const response = await POST(request);
  return response.status === 303
    ? response.headers.get("location")
    : String(response.status);
}

test("an upload is added, recorded with its size, and leads to Your books", async () => {
  current.mockResolvedValue(user);
  addBook.mockResolvedValue({ ok: true, bookId: "7" });
  // A real browser sends the length; the test's Request computes none.
  expect(await location(post(pdf(), { "content-length": "300" }))).toBe(
    "/paths#your-books",
  );
  expect(addBook).toHaveBeenCalledWith(
    expect.anything(),
    "u1",
    expect.objectContaining({ name: "ddia.pdf" }),
  );
  expect(emit).toHaveBeenCalledWith(
    "book_uploaded",
    { book_id: "7", size_bytes: 8 },
    { ...user, sessionId: "visit-1" },
  );
});

test("too large by its declared length: refused before the body is read", async () => {
  current.mockResolvedValue(user);
  const request = post(pdf(), { "content-length": String(52 * 1024 * 1024) });
  const formData = vi.spyOn(request, "formData");
  expect(await location(request)).toBe("/books/new?error=too_large");
  expect(formData).not.toHaveBeenCalled();
  expect(addBook).not.toHaveBeenCalled();
});

test("guests, the signed out, other sites and refusals", async () => {
  current.mockResolvedValue({ ...user, isGuest: true });
  expect(await location(post(pdf(), { "content-length": "300" }))).toBe(
    "/books/new?error=guest",
  );
  current.mockResolvedValue(null);
  expect(await location(post(pdf(), { "content-length": "300" }))).toBe(
    "/join",
  );
  current.mockResolvedValue(user);
  expect(
    await location(
      post(pdf(), { "content-length": "300", origin: "https://evil.example" }),
    ),
  ).toBe("403");
  addBook.mockResolvedValue({ ok: false, reason: "limit" });
  expect(await location(post(pdf(), { "content-length": "300" }))).toBe(
    "/books/new?error=limit",
  );
  expect(
    await location(post(new FormData(), { "content-length": "300" })),
  ).toBe("/books/new?error=not_pdf");
  expect(emit).not.toHaveBeenCalled();
});
