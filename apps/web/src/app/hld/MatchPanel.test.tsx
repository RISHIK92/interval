import { starterDesign } from "@interval/hld";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { MatchPanel } from "./MatchPanel";

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
      design={starterDesign()}
      ready
    />,
  );
  expect(html).not.toMatch(/\d+:\d\d left/);
  expect(html).toContain("Submit the design");
});
