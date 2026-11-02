import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { signTicket, TICKET_SECONDS } from "./tickets";

// P3-W15-S02 (ADR-0033): the web app signs; the game server checks the same fixtures
// (services/game/ticket_test.go), so the two can't drift apart.
const fixtures = JSON.parse(
  readFileSync(
    path.join(
      import.meta.dirname,
      "../../../../services/game/testdata/tickets.json",
    ),
    "utf8",
  ),
) as {
  secret: string;
  claims: { m: string; u: string; s: string; e: number; n: string };
  valid: string;
};

test("signs exactly the ticket the game server accepts", () => {
  expect(signTicket(fixtures.claims, fixtures.secret)).toBe(fixtures.valid);
});

test("another secret, or another claim, is another signature", () => {
  const other = signTicket(fixtures.claims, `${fixtures.secret}x`);
  expect(other).not.toBe(fixtures.valid);
  expect(other.split(".").slice(0, 2)).toEqual(
    fixtures.valid.split(".").slice(0, 2),
  );
  expect(
    signTicket({ ...fixtures.claims, u: "user-2" }, fixtures.secret),
  ).not.toBe(fixtures.valid);
});

test("tickets live a minute: long enough to connect, too short to share", () => {
  expect(TICKET_SECONDS).toBe(60);
});
