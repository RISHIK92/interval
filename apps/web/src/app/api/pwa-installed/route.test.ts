import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../server/ports";

// P1-W5-S06: pwa_installed, from the browser's appinstalled event.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const emit = vi.fn();
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  events: () => ({ emit }),
}));
vi.mock("../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function post(origin?: string) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/pwa-installed", {
      method: "POST",
      headers: origin === undefined ? {} : { origin },
    }),
  );
}

test("an install by a signed-in reader is counted once", async () => {
  current.mockResolvedValue(guest);
  const response = await post("http://localhost:3100");
  expect(response.status).toBe(204);
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "pwa_installed",
    {},
    { ...guest, sessionId: "visit-1" },
  );
});

test("without a session nothing is counted", async () => {
  current.mockResolvedValue(null);
  expect((await post("http://localhost:3100")).status).toBe(204);
  expect(emit).not.toHaveBeenCalled();
});

test("another site can't count an install", async () => {
  current.mockResolvedValue(guest);
  expect((await post("https://evil.test")).status).toBe(403);
  expect((await post()).status).toBe(403);
  expect(emit).not.toHaveBeenCalled();
});
