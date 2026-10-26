import { expect, test } from "vitest";
import { askingAbout, initialPrompt, promptState } from "./promptState";

// Q-P1-32: back on the feed's tab after opening a card, ask once for that open.
const open = { itemId: "5", momentId: "9" };

function run(...events: Parameters<typeof promptState>[1][]) {
  return events.reduce(promptState, initialPrompt);
}

test("opened, away and back: ask about that card", () => {
  expect(
    run({ type: "opened", open }, { type: "hidden" }, { type: "visible" })
      .prompt,
  ).toEqual(open);
});

test("asked once per open", () => {
  const asked = run(
    { type: "opened", open },
    { type: "hidden" },
    { type: "visible" },
  );
  const closed = promptState(asked, { type: "closed" });
  const again = promptState(promptState(closed, { type: "hidden" }), {
    type: "visible",
  });
  expect(again.prompt).toBeNull();
});

test("coming back without having opened a card asks nothing", () => {
  expect(run({ type: "hidden" }, { type: "visible" }).prompt).toBeNull();
});

test("a card opened but never left (e.g. a blocked new tab) asks nothing", () => {
  expect(run({ type: "opened", open }, { type: "visible" }).prompt).toBeNull();
});

test("a new open asks about the newer card", () => {
  const other = { itemId: "6", momentId: null };
  expect(
    run(
      { type: "opened", open },
      { type: "opened", open: other },
      { type: "hidden" },
      { type: "visible" },
    ).prompt,
  ).toEqual(other);
});

test("No closes the prompt", () => {
  const asked = run(
    { type: "opened", open },
    { type: "hidden" },
    { type: "visible" },
  );
  expect(promptState(asked, { type: "closed" }).prompt).toBeNull();
});

// ADR-0018: back from the in-app reader, the feed asks once about what it showed.
test("coming back from the reader asks about it once", () => {
  const asked = askingAbout(open);
  expect(asked.prompt).toEqual(open);
  const closed = promptState(asked, { type: "closed" });
  expect(
    promptState(promptState(closed, { type: "hidden" }), { type: "visible" })
      .prompt,
  ).toBeNull();
  expect(askingAbout(null)).toEqual(initialPrompt);
});

// ADR-0018: back from the in-app reader asks about what it showed, at once.
test("returning from the reader asks about that card and forgets older opens", () => {
  const opened = promptState(initialPrompt, {
    type: "opened",
    open: { itemId: "1", momentId: null },
  });
  const back = promptState(opened, {
    type: "returned",
    open: { itemId: "7", momentId: "70" },
  });
  expect(back).toEqual({
    open: null,
    left: false,
    prompt: { itemId: "7", momentId: "70" },
  });
});
