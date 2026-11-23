// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Statement } from "./Statement";

const draw = (markdown: string, dropTitle = false) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <Statement markdown={markdown} dropTitle={dropTitle} />,
  );
  const root = host.firstElementChild;
  if (root === null) throw new Error("nothing drawn");
  return root;
};
const text = (el: Element | null | undefined) =>
  el?.textContent.replace(/\s+/g, " ").trim();
const ownText = (li: Element) =>
  [...li.childNodes]
    .filter((n) => !(n instanceof Element && n.tagName === "UL"))
    .map((n) => n.textContent)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

// A problem's statement (problems/lld/<slug>/statement.md) is drawn as the brief, in
// the small part of Markdown those files use, never printed raw.
test("a heading with its text straight under it is a heading, then a paragraph", () => {
  const root = draw("## Rules\nEvery call is atomic.");
  expect([...root.children].map((e) => e.tagName)).toEqual(["H3", "P"]);
  expect(text(root.children[0])).toBe("Rules");
  expect(text(root.children[1])).toBe("Every call is atomic.");
});

test("the title is left out only when asked", () => {
  expect(text(draw("# LRU cache\n\nKeep it.", true))).toBe("Keep it.");
  expect(text(draw("# LRU cache\n\nKeep it.").querySelector("h3"))).toBe(
    "LRU cache",
  );
});

test("a note drops its markers and joins its lines", () => {
  const root = draw(
    "> PROVISIONAL: written during the build;\n> reviewed later.",
  );
  expect(root.children).toHaveLength(1);
  expect(text(root.children[0])).toBe(
    "PROVISIONAL: written during the build; reviewed later.",
  );
});

test("a list item that wraps onto indented lines stays one item", () => {
  const root = draw("- `get(key)`: the value,\n  or -1.\n- `put(key, value)`");
  expect([...root.querySelectorAll("li")].map(text)).toEqual([
    "get(key): the value, or -1.",
    "put(key, value)",
  ]);
});

test("`code` and **bold** inside text", () => {
  const root = draw("Keep a set of **stops** at `0..floors`.");
  expect(text(root.querySelector("strong"))).toBe("stops");
  expect(text(root.querySelector("code"))).toBe("0..floors");
  expect(root.textContent).not.toMatch(/\*\*|`/);
});

// The elevator's step() has two sub-cases, indented under its item.
test("indented items are a nested list under their item", () => {
  const markdown = readFileSync(
    join(
      __dirname,
      "../../../../../../../problems/lld/elevator-system/statement.md",
    ),
    "utf8",
  );
  const root = draw(markdown, true);
  const top = root.querySelector(":scope > ul");
  const items = [...(top?.querySelectorAll(":scope > li") ?? [])];
  expect(items.map((li) => ownText(li).split(":")[0])).toEqual([
    "ElevatorSystem(elevators, floors)",
    "request(floor)",
    "press(elevator, floor)",
    "step()",
    "status(elevator)",
  ]);
  const step = items[3];
  expect(step === undefined ? "" : ownText(step)).toMatch(
    /ties go to the lower floor\):$/,
  );
  const nested = [...(step?.querySelectorAll(":scope > ul > li") ?? [])];
  expect(nested.map(text)).toEqual([
    "if the target is the floor it is on, it opens its doors there (the stop is removed) and does not move;",
    "otherwise it moves one floor toward the target, and if that floor is one of its stops, it opens its doors there (the stop is removed).",
  ]);
  expect(root.textContent).not.toMatch(/ - (if|otherwise) /);
  // A wrapped line back at the top level carries on its own item, not the nested one.
  expect(ownText(items[4] ?? root)).toMatch(
    /or "0 idle -"\. An unknown elevator fails\.$/,
  );
});

test("Windows line endings read as the same statement", () => {
  const root = draw("## Rules\r\nAtomic.\r\n\r\n- one\r\n  wrapped\r\n- two");
  expect([...root.children].map((e) => e.tagName)).toEqual(["H3", "P", "UL"]);
  expect([...root.querySelectorAll("li")].map(text)).toEqual([
    "one wrapped",
    "two",
  ]);
});

test("markup in a statement stays text", () => {
  const root = draw("Never <script>alert(1)</script> run.");
  expect(root.querySelector("script")).toBeNull();
  expect(root.textContent).toContain("<script>alert(1)</script>");
});
