import { afterEach, expect, test, vi } from "vitest";

// A POST from the site itself (P2-W11-S01, S04).
const env = vi.fn(() => ({
  BETTER_AUTH_URL: "http://localhost:3100",
  NODE_ENV: "production",
}));
vi.mock("../env", () => ({ env: () => env() }));

afterEach(() => {
  vi.clearAllMocks();
});

function request(origin: string | null, host: string): Request {
  const headers = new Headers({ host });
  if (origin !== null) headers.set("origin", origin);
  // Next reports the URL as localhost whichever name the browser used.
  return new Request("http://localhost:3100/api/x", {
    method: "POST",
    headers,
  });
}

test("the site's own origin passes; another site or none doesn't", async () => {
  const { sameOrigin } = await import("./same-origin");
  expect(sameOrigin(request("http://localhost:3100", "localhost:3100"))).toBe(
    true,
  );
  expect(sameOrigin(request("https://evil.example", "localhost:3100"))).toBe(
    false,
  );
  expect(sameOrigin(request(null, "localhost:3100"))).toBe(false);
  // In production, 127.0.0.1 isn't the site, even when it's the Host.
  expect(sameOrigin(request("http://127.0.0.1:3100", "127.0.0.1:3100"))).toBe(
    false,
  );
});

test("in development, 127.0.0.1 beside localhost passes when it is the Host", async () => {
  env.mockReturnValue({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "development",
  });
  const { sameOrigin } = await import("./same-origin");
  expect(sameOrigin(request("http://127.0.0.1:3100", "127.0.0.1:3100"))).toBe(
    true,
  );
  // A page on another site posting to us: its origin isn't our Host.
  expect(sameOrigin(request("http://evil.test:3100", "127.0.0.1:3100"))).toBe(
    false,
  );
});
