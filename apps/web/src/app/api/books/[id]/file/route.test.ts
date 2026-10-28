import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Books, FileStore } from "../../../../../server/ports";

// P2-W11-S04: the user's own PDF, for the reader.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const fileKey = vi.fn<Books["fileKey"]>();
const get = vi.fn<FileStore["get"]>();
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  books: () => ({ fileKey }),
  files: () => ({ get }),
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function fetchFile(id = "7"): Promise<Response> {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost:3100/api/books/${id}/file`), {
    params: Promise.resolve({ id }),
  });
}

test("the owner gets their PDF; the browser revalidates its copy each time", async () => {
  current.mockResolvedValue(user);
  fileKey.mockResolvedValue("books/u1/x.pdf");
  const body = new Response("%PDF-1.7").body;
  if (body === null) throw new Error("seed");
  get.mockResolvedValueOnce({ body, etag: '"abc"', size: 8 });
  const response = await fetchFile();
  expect(fileKey).toHaveBeenCalledWith("u1", "7");
  expect(get).toHaveBeenCalledWith("books/u1/x.pdf", undefined);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("cache-control")).toBe("private, no-cache");
  expect(response.headers.get("etag")).toBe('"abc"');
  expect(response.headers.get("content-length")).toBe("8");
  expect(await response.text()).toBe("%PDF-1.7");
  // The browser's copy still matches: 304, no body.
  get.mockResolvedValueOnce("unchanged");
  const { GET } = await import("./route");
  const again = await GET(
    new Request("http://localhost:3100/api/books/7/file", {
      headers: { "If-None-Match": '"abc"' },
    }),
    { params: Promise.resolve({ id: "7" }) },
  );
  expect(get).toHaveBeenLastCalledWith("books/u1/x.pdf", '"abc"');
  expect(again.status).toBe(304);
  expect(again.headers.get("cache-control")).toBe("private, no-cache");
});

test("anyone else, a book not ready, a missing file or a bad id: nothing", async () => {
  current.mockResolvedValue(user);
  fileKey.mockResolvedValueOnce(null);
  expect((await fetchFile()).status).toBe(404);
  fileKey.mockResolvedValueOnce("books/u1/x.pdf");
  get.mockResolvedValueOnce(null);
  expect((await fetchFile()).status).toBe(404);
  expect((await fetchFile("x")).status).toBe(404);
  current.mockResolvedValue(null);
  expect((await fetchFile()).status).toBe(401);
});
