import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ReplayView } from "./Replay";
import { ResultActionsView } from "./ResultActions";

// P5-W35 (§6.5, AI-1; Q-P5-14, Q-P5-22): the results page's replay, AI review and
// dispute.
const actions = (over: Partial<Parameters<typeof ResultActionsView>[0]> = {}) =>
  renderToStaticMarkup(
    <ResultActionsView
      hasBest
      review={null}
      disputed={false}
      disputeOpen
      reason=""
      notice={null}
      onReason={() => undefined}
      onReview={() => undefined}
      onDispute={() => undefined}
      {...over}
    />,
  );

test("the review is asked for, then shown labelled AI and apart from ratings", () => {
  expect(actions()).toContain("Review my best submission (AI)");
  expect(actions({ hasBest: false })).toContain("nothing to review");
  expect(actions({ review: { status: "pending", review: null } })).toContain(
    "Being written",
  );
  const ready = actions({
    review: { status: "ready", review: "A clear design." },
  });
  expect(ready).toContain(">AI</span>");
  expect(ready).toContain("doesn&#x27;t affect your rating");
  expect(ready).toContain("A clear design.");
});

test("a dispute once, within 7 days", () => {
  expect(actions()).toContain("Dispute this result");
  expect(actions({ disputed: true })).toContain("You disputed this result");
  expect(actions({ disputeOpen: false })).toContain("disputed for 7 days");
});

test("the replay shows the moment's player, time and code", () => {
  const html = renderToStaticMarkup(
    <ReplayView
      frames={[
        { name: "You", takenAt: "2026-11-14T10:00:30Z" },
        { name: "Bob", takenAt: "2026-11-14T10:01:00Z" },
      ]}
      at={1}
      shown={{ language: "go", code: "type Cache struct{}" }}
      missing={false}
      onAt={() => undefined}
    />,
  );
  expect(html).toContain("Bob");
  expect(html).toContain("type Cache struct{}");
  expect(html).toContain('max="1"');
});
