import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { WaitingView } from "./Waiting";

// P6-W42 (Q-P6-06): while the judge works, the page says so, says it updates by
// itself, and says when it can't check.
test("scoring explains the wait, and a failed check", () => {
  const html = renderToStaticMarkup(<WaitingView unreachable={false} />);
  expect(html).toContain('role="status"');
  expect(html).toContain("Scoring…");
  expect(html).toContain("up to 15 minutes");
  expect(html).not.toContain("Couldn&#x27;t check");
  expect(renderToStaticMarkup(<WaitingView unreachable />)).toContain(
    "Couldn&#x27;t check on the scoring",
  );
});
