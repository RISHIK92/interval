import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Page } from "./Page";

const frame = (html: string) => /^<div class="([^"]*)"/.exec(html)?.[1] ?? "";

// Phones: the frame leaves room under the content for the fixed tab bar.
test("with the phone tab bar, the page clears it at the bottom", () => {
  const html = renderToStaticMarkup(
    <Page tab="play" firstName={null}>
      <p>Body</p>
    </Page>,
  );
  expect(frame(html)).toContain("pb-[calc(6rem+env(safe-area-inset-bottom))]");
  expect(html).toMatch(
    /<nav[^>]*class="[^"]*fixed inset-x-0 bottom-0 z-10 flex /,
  );
});

// The pages that never had a phone tab bar keep the bottom space they had (pb-12),
// not the room a bar they don't show would need.
test("without the phone tab bar, the page keeps its own bottom space", () => {
  const html = renderToStaticMarkup(
    <Page tab="play" firstName={null} phoneTabBar={false}>
      <p>Body</p>
    </Page>,
  );
  expect(frame(html)).toContain("pb-12");
  expect(frame(html)).not.toContain("6rem");
  expect(html).toMatch(/<nav[^>]*class="[^"]*hidden lg:flex/);
});
