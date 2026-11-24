import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import SpecPage from "./page";

// P6-W36 (CANVAS-4): the public spec sheet shows every component's numbers and the
// patch notes, without the client (it's the traffic, not a component you size).
test("the spec sheet lists the components, their numbers and the patch notes", () => {
  const html = renderToStaticMarkup(<SpecPage />);
  expect(html).toContain("Version 2.0, from 1 Dec 2026, a season boundary.");
  // A version is taken up by families made for it: 1.0's stay on 1.0 for good.
  expect(html).toContain(
    "Families made on version 1.0 stay on it, before and after that boundary; only families made for 2.0 run on 2.0, from it.",
  );
  expect(html).not.toContain("Until then every match");
  expect(html).toContain("provisional until launch");
  expect(html).toContain("Load balancer");
  expect(html).toContain("Stream processor");
  expect(html).toContain(
    "10,000 reads/s per instance; writes 2,000/s on the primary",
  );
  expect(html).toContain(
    "1,000 requests/s per node; 1,000 Mbps of payload from 2.0",
  );
  expect(html).toContain("99.90%");
  expect(html).not.toContain("The problem&#x27;s users");
  expect(html).toContain("Patch notes");
  expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

// No frame, but never a dead end: the first focusable thing leads back to the lobby.
test("the spec sheet leads back to HLD battles", () => {
  const html = renderToStaticMarkup(<SpecPage />);
  expect(html).toMatch(/<a[^>]*href="\/hld\/play"[^>]*>‹ HLD battles<\/a>/);
});

// The sheet is public and static: built once, with no request to read a session from,
// so it stands alone without the app's frame.
test("the spec sheet is static: no session read, no app frame", () => {
  const page = SpecPage();
  expect(page).not.toBeInstanceOf(Promise);
  expect(renderToStaticMarkup(page)).not.toContain('aria-label="Main"');
});

// ADR-0050 §6, Q-WD-31: v2.0 at its season boundary, with what it adds and its notes.
test("the sheet shows 2.0: the provider marked new, the engine's bytes and backlog, and its notes", () => {
  const html = renderToStaticMarkup(<SpecPage />);
  expect(html).toContain("External provider");
  expect(html.match(/New in 2\.0/g)).toHaveLength(1);
  expect(html).toContain("Set by each problem: calls/s");
  expect(html).toContain("Per call, set by each problem");
  expect(html).toContain(
    "$0.02 a GB from a CDN, $0.09 a GB from anything else",
  );
  expect(html).toContain("A spike or outage lasts 15 minutes");
  expect(html).toMatch(/2\.0 <span[^>]*>· 1 Dec 2026/);
  expect(html).toContain("New component: the external provider");
  expect(html).toContain("Every version 1.0 number is unchanged");
});
