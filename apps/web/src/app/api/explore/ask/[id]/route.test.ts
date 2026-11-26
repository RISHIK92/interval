import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Actor, Asks } from "../../../../../server/ports";

// ADR-0046: a user reads and deletes only their own questions.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
const get = vi.fn<Asks["get"]>(() => Promise.resolve(null));
const remove = vi.fn<Asks["remove"]>(() => Promise.resolve(false));
vi.mock("../../../../../server/container", () => ({
  entitlements: () => ({ can }),
  sessionReader: () => ({ current }),
  asks: () => ({ get, remove }),
}));
vi.mock("../../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

const ID = "11111111-1111-4111-8111-111111111111";
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: null };

beforeEach(() => {
  current.mockResolvedValue(ada);
});
afterEach(() => {
  vi.clearAllMocks();
});

async function call(
  method: "GET" | "DELETE",
  id = ID,
  origin = "http://localhost:3100",
): Promise<Response> {
  const route = await import("./route");
  const request = new Request(`http://localhost:3100/api/explore/ask/${id}`, {
    method,
    headers: { origin },
  });
  const context = { params: Promise.resolve({ id }) };
  return method === "GET"
    ? route.GET(request, context)
    : route.DELETE(request, context);
}

test("GET: the owner's question, never cached; anyone else's is not found", async () => {
  get.mockResolvedValueOnce({
    id: ID,
    text: "q",
    chip: null,
    askedAt: new Date(),
    depth: 0,
    answer: null,
  });
  const res = await call("GET");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(get).toHaveBeenCalledWith(ID, "u1");
  expect((await call("GET")).status).toBe(404);
  expect((await call("GET", "nope")).status).toBe(400);
});

test("GET: signed out 401, a guest or a plan without Ask 403", async () => {
  current.mockResolvedValueOnce(null);
  expect((await call("GET")).status).toBe(401);
  current.mockResolvedValueOnce({ ...ada, isGuest: true });
  expect((await call("GET")).status).toBe(403);
  can.mockResolvedValueOnce(false);
  expect((await call("GET")).status).toBe(403);
  expect(get).not.toHaveBeenCalled();
});

test("DELETE: the owner's goes (204); another's isn't found; other origins refused", async () => {
  remove.mockResolvedValueOnce(true);
  expect((await call("DELETE")).status).toBe(204);
  expect(remove).toHaveBeenCalledWith(ID, "u1");
  expect((await call("DELETE")).status).toBe(404);
  expect((await call("DELETE", ID, "https://elsewhere.example")).status).toBe(
    403,
  );
  expect(remove).toHaveBeenCalledTimes(2);
});
