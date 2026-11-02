import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { GhostFrame } from "./LivePlay";

// P3-W17-S01 (BOT-3, BOT-4): a ghost is labeled for the whole match, and its end says
// the rating moved half as much; a person's match shows neither.
test("a ghost match carries its label throughout, and the half rating at the end", () => {
  const playing = renderToStaticMarkup(
    <GhostFrame label="Ghost · ~1600" finished={false}>
      <p>question</p>
    </GhostFrame>,
  );
  expect(playing).toContain("vs Ghost · ~1600");
  expect(playing).toContain("question");
  expect(playing).not.toContain("half as much");
  const ended = renderToStaticMarkup(
    <GhostFrame label="Ghost · ~1600" finished>
      <p>result</p>
    </GhostFrame>,
  );
  expect(ended).toContain("vs Ghost · ~1600");
  expect(ended).toContain("your rating moves half as much");
});

test("a match against a person adds nothing", () => {
  expect(
    renderToStaticMarkup(
      <GhostFrame label={null} finished>
        <p>result</p>
      </GhostFrame>,
    ),
  ).toBe("<p>result</p>");
});
