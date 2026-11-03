import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { FallbackCountdown, ReplayFrame } from "./LivePlay";

// P3-W17-S01 (BOT-3, BOT-4): a ghost is labeled for the whole match, and its end says
// the rating moved half as much; a person's match shows neither.
test("a ghost match carries its label throughout, and the half rating at the end", () => {
  const playing = renderToStaticMarkup(
    <ReplayFrame label="Ghost · ~1600" finished={false}>
      <p>question</p>
    </ReplayFrame>,
  );
  expect(playing).toContain("vs Ghost · ~1600: not a live player");
  expect(playing).toContain("question");
  expect(playing).not.toContain("half as much");
  const ended = renderToStaticMarkup(
    <ReplayFrame label="Ghost · ~1600" finished>
      <p>result</p>
    </ReplayFrame>,
  );
  expect(ended).toContain("vs Ghost · ~1600");
  expect(ended).toContain("your rating moves half as much");
  const bot = renderToStaticMarkup(
    <ReplayFrame label="Bot · ~1500" finished={false}>
      <p>q</p>
    </ReplayFrame>,
  );
  expect(bot).toContain("vs Bot · ~1500: not a live player");
});

test("a match against a person adds nothing", () => {
  expect(
    renderToStaticMarkup(
      <ReplayFrame label={null} finished>
        <p>result</p>
      </ReplayFrame>,
    ),
  ).toBe("<p>result</p>");
});

// C-01 (screen 11): the countdown to the switch starts at 10 s.
test("the queue counts down to a ghost or bot from 10 s", () => {
  const html = renderToStaticMarkup(<FallbackCountdown since={Date.now()} />);
  expect(html).toContain("A ghost or bot in 10s");
  expect(html).toContain('aria-valuenow="10"');
  // Rendered 4 s into the wait (the first paint takes `since` as now; the clock then
  // ticks): the arithmetic, at a later moment.
  const later = renderToStaticMarkup(
    <FallbackCountdown since={Date.now()} at={Date.now() + 4_000} />,
  );
  expect(later).toContain("A ghost or bot in 6s");
  expect(later).toContain('aria-valuenow="6"');
});
