import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Countdown, secondsLeft } from "./Countdown";

// The sprint's clock on screen (Q-P2-14): the server decides; this shows it and
// finishes the quiz when it runs out (that submit is checked in the browser: no DOM
// test environment here).
test("seconds left round up and stop at zero", () => {
  const now = Date.parse("2026-10-28T10:00:00Z");
  expect(secondsLeft(new Date(now + 33_400).toISOString(), now)).toBe(34);
  expect(secondsLeft(new Date(now + 60_000).toISOString(), now)).toBe(60);
  expect(secondsLeft(new Date(now).toISOString(), now)).toBe(0);
  expect(secondsLeft(new Date(now - 5_000).toISOString(), now)).toBe(0);
});

test("it shows the time left as a bar and in words", () => {
  const html = renderToStaticMarkup(
    <Countdown
      endsAt={new Date(Date.now() + 30_000).toISOString()}
      finishForm="finish"
    />,
  );
  expect(html).toMatch(/(29|30)s left/);
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuemax="60"');
});
