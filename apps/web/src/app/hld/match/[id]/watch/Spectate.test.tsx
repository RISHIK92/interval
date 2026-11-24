import { practiceProblems } from "@interval/hld";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { Spectate } from "./Spectate";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const problem = (() => {
  const p = practiceProblems(new Date())[0];
  if (p === undefined) throw new Error("no practice problem");
  return p;
})();

// The server's clock differs from the browser's: the time left waits for the browser,
// so the first paint hydrates without a mismatch.
test("on the server, the watch page shows no time left", () => {
  const html = renderToString(
    <Spectate
      matchId="m1"
      problem={problem}
      initial={{
        over: false,
        deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
        seats: [],
      }}
    />,
  );
  expect(html).toContain("Designs update as the players autosave.");
  expect(html).not.toContain("min left");
});
