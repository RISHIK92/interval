import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Clock } from "./Clock";

// The server's clock differs from the browser's, so the time left appears only once
// mounted; otherwise hydration would mismatch on the text and the label.
test("the server renders the clock without a time", () => {
  const deadline = new Date(Date.now() + 5 * 60_000).toISOString();
  const html = renderToStaticMarkup(<Clock deadline={deadline} />);
  expect(html).toContain('role="timer"');
  expect(html).not.toMatch(/\d+:\d\d/);
  expect(html).not.toContain("seconds left");
});
