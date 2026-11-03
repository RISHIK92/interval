import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AcceptedBanner } from "./Presence";

// P3-W17-S03 (Q-P3-16): a sender's tab says a friend accepted, with Join now into the
// match; nothing when there's nothing.
test("an accepted challenge shows Join now into its match, dismissible", () => {
  const html = renderToStaticMarkup(
    <AcceptedBanner
      accepted={{ matchId: "m-1", mode: "fastest_finger" }}
      onDone={vi.fn()}
    />,
  );
  expect(html).toContain("Your friend accepted your challenge");
  expect(html).toContain('href="/play/live/fastest-finger?match=m-1"');
  expect(html).toContain('aria-label="Dismiss"');
  expect(html).toContain('role="alert"');
});

test("nothing accepted: nothing shown", () => {
  expect(
    renderToStaticMarkup(<AcceptedBanner accepted={null} onDone={vi.fn()} />),
  ).toBe("");
});
