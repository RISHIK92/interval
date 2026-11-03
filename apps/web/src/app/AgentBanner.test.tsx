import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { AgentBanner } from "./AgentBanner";

// P3-W17-S04 (C-10, Q-P3-28): elapsed time only while the agent runs; the saved place
// after it finished; nothing otherwise.
const NOW = 1_800_000_000_000;

test("a running agent shows how long it has run, never a time left", () => {
  const html = renderToStaticMarkup(
    <AgentBanner startedAt={NOW - 3 * 60_000 - 5_000} place={null} now={NOW} />,
  );
  expect(html).toContain("Agent running · 3 min");
  expect(html).not.toMatch(/left|remaining/i);
});

test("after it finished: back to the saved place", () => {
  const html = renderToStaticMarkup(
    <AgentBanner startedAt={null} place="/read/42?m=3" now={NOW} />,
  );
  expect(html).toContain('href="/read/42?m=3"');
  expect(html).toContain("Pick up where you left off");
});

test("neither: nothing", () => {
  expect(
    renderToStaticMarkup(
      <AgentBanner startedAt={null} place={null} now={NOW} />,
    ),
  ).toBe("");
});
