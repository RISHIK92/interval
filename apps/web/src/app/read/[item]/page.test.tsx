import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  OutboundLinks,
  Progress,
  ReaderPage,
} from "../../../server/ports";

// ADR-0018: the in-app reader frames the publisher's live page, with Interval's
// header above it and the overlay below it.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const reader = vi.fn<OutboundLinks["reader"]>();
const emit = vi.fn();
const recordOpen = vi.fn<Progress["recordOpen"]>(() => Promise.resolve());
const countExploreOpen = vi.fn<Progress["countExploreOpen"]>(() =>
  Promise.resolve(),
);
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  outboundLinks: () => ({ reader }),
  progress: () => ({ recordOpen, countExploreOpen }),
  events: () => ({ emit }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };
const context = { ...guest, sessionId: "visit-1" };

const page: ReaderPage = {
  link: { url: "https://pub.test/post#raft", linkType: "anchor" },
  frameable: true,
  articleTitle: "Consensus in practice",
  sectionTitle: "Raft",
  sourceName: "Pub Engineering",
  note: { text: "Leaders get elected this way.", ai: true },
  saved: false,
  nextMomentId: "10",
};

afterEach(() => {
  vi.clearAllMocks();
});

async function render(
  query: Record<string, string | string[]>,
  item = "5",
): Promise<string> {
  const { default: ReadPage } = await import("./page");
  return renderToStaticMarkup(
    await ReadPage({
      params: Promise.resolve({ item }),
      searchParams: Promise.resolve(query),
    }),
  );
}

const card = { moment: "9", chip: "3-8", pos: "4" };

test("without a session the visitor is sent to /join", async () => {
  current.mockResolvedValue(null);
  await expect(render(card)).rejects.toThrow("redirect:/join");
  expect(reader).not.toHaveBeenCalled();
});

test.each([
  ["a bad item id", card, "5x"],
  ["a bad moment id", { ...card, moment: "abc" }, "5"],
  ["no chip", { moment: "9", pos: "4" }, "5"],
  ["a bad chip", { ...card, chip: "2-4" }, "5"],
  ["a position past 200", { ...card, pos: "201" }, "5"],
  ["neither a position nor from", { moment: "9", chip: "3-8" }, "5"],
  ["from with a position", { ...card, from: "continue" }, "5"],
  ["a Library open", { chip: "3-8", from: "library" }, "5"],
  ["a repeated chip", { ...card, chip: ["3-8", "1-3"] }, "5"],
])("%s goes home with no lookup or events", async (_name, query, item) => {
  current.mockResolvedValue(guest);
  await expect(render(query, item)).rejects.toThrow(/^redirect:\/$/);
  expect(reader).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test.each([
  ["not frameable", { ...page, frameable: false }],
  ["not found", null],
  // The frame only takes https (ADR-0018's frame-src).
  [
    "on plain http",
    { ...page, link: { ...page.link, url: "http://pub.test/" } },
  ],
])(
  "an item %s opens in the browser through /out instead",
  async (_name, found) => {
    current.mockResolvedValue(guest);
    reader.mockResolvedValue(found);
    await expect(render(card)).rejects.toThrow(
      "redirect:/out?item=5&moment=9&chip=3-8&pos=4&target=section",
    );
    expect(emit).not.toHaveBeenCalled();
    expect(recordOpen).not.toHaveBeenCalled();
  },
);

test("a feed card's open is recorded as in_app, with no outbound click", async () => {
  current.mockResolvedValue(guest);
  reader.mockResolvedValue(page);
  await render(card);
  expect(reader).toHaveBeenCalledWith("g1", "5", "9");
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "card_opened",
    {
      kind: "moment",
      chip: "3-8",
      position: 4,
      item_id: "5",
      moment_id: "9",
      surface: "in_app",
    },
    context,
  );
  expect(recordOpen).toHaveBeenCalledExactlyOnceWith("g1", "5", "9");
  expect(countExploreOpen).toHaveBeenCalledExactlyOnceWith(
    "g1",
    "3-8",
    "5",
    "9",
  );
});

test("a Continue open counts as continue_clicked; a move inside the reader counts nothing", async () => {
  current.mockResolvedValue(guest);
  reader.mockResolvedValue(page);
  await render({ moment: "9", chip: "3-8", from: "continue" });
  expect(emit).toHaveBeenCalledExactlyOnceWith("continue_clicked", {}, context);
  emit.mockClear();
  recordOpen.mockClear();
  await render({ moment: "10", chip: "3-8", from: "reader" });
  expect(emit).not.toHaveBeenCalled();
  expect(recordOpen).toHaveBeenCalledExactlyOnceWith("g1", "5", "10");
  expect(countExploreOpen).not.toHaveBeenCalled();
});

test("Next section from a Continue card stays a Continue open; after Save it counts nothing", async () => {
  current.mockResolvedValue(guest);
  reader.mockResolvedValue(page);
  expect(await render({ moment: "9", chip: "3-8", from: "continue" })).toMatch(
    /<a href="\/read\/5\?moment=10&amp;chip=3-8&amp;from=continue"[^>]*>[^]*?Next section<\/span><\/a>/,
  );
  expect(await render({ moment: "9", chip: "3-8", from: "reader" })).toMatch(
    /<a href="\/read\/5\?moment=10&amp;chip=3-8&amp;from=reader"[^>]*>[^]*?Next section<\/span><\/a>/,
  );
});

test("frames the attributed publisher page in a sandbox", async () => {
  current.mockResolvedValue(guest);
  reader.mockResolvedValue(page);
  const html = await render(card);
  // The frame mounts after hydration (so its load can't be missed); the page hands it
  // the attributed source and title.
  expect(html).toContain(
    'data-frame-src="https://pub.test/post?utm_source=interval#raft"',
  );
  expect(html).toContain('data-frame-title="Raft — Consensus in practice"');
  // No tab bar: the reader takes the whole screen.
  expect(html).not.toContain('aria-label="Tabs"');
});

test("the frame itself is sandboxed and keeps the publisher's referrer policy", async () => {
  const { FRAME_SANDBOX, FRAME_REFERRER } = await import("./ReaderFrame");
  expect(FRAME_SANDBOX).toBe(
    "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms",
  );
  expect(FRAME_REFERRER).toBe("strict-origin-when-cross-origin");
});

test("the header closes to the feed asking about this section, and opens it in the browser", async () => {
  current.mockResolvedValue(guest);
  reader.mockResolvedValue(page);
  const html = await render(card);
  expect(html).toMatch(/<a href="\/\?chip=3-8&amp;ask=5\.9"[^>]*>/);
  expect(html).toContain('aria-label="Close reader"');
  expect(html).toContain("pub.test");
  // The open is counted once: leaving for the browser is from=reader (an outbound click
  // only), and the arrow's name says where it goes.
  expect(html).toMatch(
    /<a href="\/out\?item=5&amp;moment=9&amp;from=reader&amp;target=section" target="_blank" rel="noopener noreferrer" aria-label="Open in browser"/,
  );
});

test("a section the link fell back from is closed and finished as the article", async () => {
  current.mockResolvedValue(guest);
  reader.mockResolvedValue({
    ...page,
    link: { url: "https://pub.test/post", linkType: "article" },
    sectionTitle: null,
    nextMomentId: null,
  });
  const html = await render(card);
  expect(html).toMatch(/<a href="\/\?chip=3-8&amp;ask=5\."[^>]*>/);
  expect(html).not.toContain('name="momentId"');
  expect(emit).toHaveBeenCalledWith(
    "card_opened",
    expect.objectContaining({ moment_id: null, surface: "in_app" }),
    context,
  );
});

test("the overlay: why this matters, Save that stays, Mark done, Next section, and three coming later", async () => {
  current.mockResolvedValue(guest);
  reader.mockResolvedValue(page);
  const html = await render(card);
  // AI-1, AI-3: the model's note is labelled AI.
  expect(html).toContain("Leaders get elected this way.");
  expect(html).toMatch(/border-dashed[^>]*>[^<]*Why this matters/);
  expect(html).toContain(">AI</span>");
  // Save posts the feedback control and comes back to this reader.
  expect(html).toMatch(/<button[^>]*value="save"[^>]*name="control"/);
  expect(html).toContain(
    'name="back" value="/read/5?moment=9&amp;chip=3-8&amp;from=reader"',
  );
  // Mark done finishes this section and skips the prompt.
  expect(html).toContain('name="method" value="mark_done"');
  expect(html).toContain('name="momentId" value="9"');
  expect(html).toContain("Mark done");
  // On phones a tick and an arrow; the words stay for screen readers and wider
  // screens (owner, 2026-10-26).
  expect(html).toMatch(
    /<svg[^>]*class="[^"]*sm:hidden[^"]*"[^>]*><path d="M5 12l5 5 9-10"><\/path><\/svg><span class="sr-only sm:not-sr-only">Mark done<\/span>/,
  );
  expect(html).toMatch(
    /<svg[^>]*class="[^"]*sm:hidden[^"]*"[^>]*><path d="M5 12h14M13 6l6 6-6 6"><\/path><\/svg><span class="sr-only sm:not-sr-only">Next section<\/span>/,
  );
  // Next section is an open of that section from the same card, so it counts like one
  // (owner, 2026-10-26).
  expect(html).toMatch(
    /<a href="\/read\/5\?moment=10&amp;chip=3-8&amp;pos=4"[^>]*>[^]*?Next section<\/span><\/a>/,
  );
  expect(html.match(/aria-disabled="true"/g)).toHaveLength(3);
  expect(html.match(/Coming later/g)?.length).toBeGreaterThanOrEqual(3);
  for (const name of ["Highlight", "Listen", "Test me"]) {
    expect(html).toContain(name);
  }
});

test("the last section has no Next section; a saved item says Saved; a template note is not AI", async () => {
  current.mockResolvedValue(guest);
  reader.mockResolvedValue({
    ...page,
    nextMomentId: null,
    saved: true,
    note: { text: "A classic.", ai: false },
  });
  const html = await render(card);
  expect(html).not.toContain("Next section");
  expect(html).toMatch(/<button[^>]*value="unsave"[^>]*name="control"/);
  expect(html).toContain("A classic.");
  expect(html).not.toContain(">AI</span>");
});
