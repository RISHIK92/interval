import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { FINGER } from "@interval/game-client";
import { LivePlay } from "./LivePlay";

vi.mock("./join", () => ({ openMatch: vi.fn() }));

// P3-W18-S02 (owner, 2026-11-05): players are told, in one line during a match, that
// leaving the tab in a round is noted for fair play.
test("a match says that leaving the tab is noted for fair play", () => {
  const html = renderToStaticMarkup(
    <LivePlay
      mode="fastest_finger"
      matchId="m1"
      game={FINGER}
      current={() => null}
      View={() => <p>the match</p>}
    />,
  );
  expect(html).toContain("the match");
  expect(html).toContain(
    "Leaving this tab during a round is noted for fair play.",
  );
});

test("the queue doesn't say it", () => {
  const html = renderToStaticMarkup(
    <LivePlay
      mode="fastest_finger"
      game={FINGER}
      current={() => null}
      View={() => <p>the match</p>}
    />,
  );
  expect(html).not.toContain("fair play");
});
