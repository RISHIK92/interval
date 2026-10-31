import { expect, test, vi } from "vitest";
import { isLocalRequest } from "./local-request";

// ADR-0030: the email-only reset answers only a request made on this machine.
const h = (fields: Record<string, string>) => new Headers(fields);

test("a request to localhost, 127.0.0.1 or [::1] is local", () => {
  for (const host of [
    "localhost:3100",
    "127.0.0.1:3100",
    "[::1]:3100",
    "localhost",
  ])
    expect(isLocalRequest(h({ host, "x-forwarded-for": "::1" }))).toBe(true);
  expect(
    isLocalRequest(
      h({
        host: "localhost:3100",
        "x-forwarded-host": "localhost:3100",
        "x-forwarded-for": "::1, 127.0.0.1, ::ffff:127.0.0.1",
      }),
    ),
  ).toBe(true);
});

test("through a tunnel or from another machine it isn't", () => {
  expect(
    isLocalRequest(h({ host: "647a-115-244-141-202.ngrok-free.app" })),
  ).toBe(false);
  // A tunnel rewriting Host to localhost still forwards the visitor's address.
  expect(
    isLocalRequest(
      h({ host: "localhost:3100", "x-forwarded-for": "115.244.141.202" }),
    ),
  ).toBe(false);
  expect(
    isLocalRequest(
      h({ host: "localhost:3100", "x-forwarded-host": "evil.example" }),
    ),
  ).toBe(false);
  expect(isLocalRequest(h({ host: "localhost.evil.example" }))).toBe(false);
  // Next always sets x-forwarded-for; missing or empty means it can't be trusted.
  expect(isLocalRequest(h({ host: "localhost:3100" }))).toBe(false);
  expect(
    isLocalRequest(h({ host: "localhost:3100", "x-forwarded-for": "" })),
  ).toBe(false);
  expect(isLocalRequest(h({ host: "192.168.1.5:3100" }))).toBe(false);
  expect(isLocalRequest(h({}))).toBe(false);
});

test("a production build never treats a request as local", () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    expect(
      isLocalRequest(h({ host: "localhost:3100", "x-forwarded-for": "::1" })),
    ).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});
