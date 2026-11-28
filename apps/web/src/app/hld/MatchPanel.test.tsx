import { starterDesign } from "@interval/hld";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { LeaveMatch, MatchPanel } from "./MatchPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// The match page showed a hydration error (owner, 2026-11-23): the panel's phone clock
// read the server's time, and the browser's a moment later differs. As the header's
// Clock does, the time left appears only once mounted.
test("the server renders the panel without a time left", () => {
  const deadline = new Date(Date.now() + 5 * 60_000).toISOString();
  const html = renderToStaticMarkup(
    <MatchPanel
      matchId="m1"
      deadline={deadline}
      submitted={false}
      design={starterDesign("1.0")}
      ready
      onSubmitted={() => undefined}
    />,
  );
  expect(html).not.toMatch(/\d+:\d\d left/);
  expect(html).toContain("Submit the design");
});

// Q-WD-16: the header's × asks before leaving; leaving goes to the HLD Play page.
test("leaving the match asks first, and says the last autosave still counts", () => {
  const html = renderToStaticMarkup(<LeaveMatch />);
  expect(html).toContain('aria-label="Leave the match"');
  expect(html).toContain("Leave the match?");
  expect(html).toContain("Your last autosave is submitted at the deadline.");
});
