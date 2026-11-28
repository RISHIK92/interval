import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { SlowBar } from "./ReaderFrame";
import type {
  Actor,
  Listening,
  Notes,
  OutboundLinks,
  Progress,
  Quizzes,
  ReaderPage,
} from "../../../server/ports";

// ADR-0018: the in-app reader frames the publisher's live page, with Interval's
// header above it and the overlay below it. ADR-0058: always the whole article, with
// Quiz me and Done (or Completed), and no section navigation.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const reader = vi.fn<OutboundLinks["reader"]>();
const onItems = vi.fn<Notes["onItems"]>(() => Promise.resolve([]));
const offered = vi.fn<Quizzes["offered"]>(() => Promise.resolve(new Set()));
const voiced = vi.fn<Listening["voiced"]>(() => Promise.resolve([]));
const emit = vi.fn();
const recordOpen = vi.fn<Progress["recordOpen"]>(() => Promise.resolve());
const countExploreOpen = vi.fn<Progress["countExploreOpen"]>(() =>
  Promise.resolve(),
);
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  outboundLinks: () => ({ reader }),
  progress: () => ({ recordOpen, countExploreOpen }),
  notes: () => ({ onItems }),
  quizzes: () => ({ offered }),
  listening: () => ({ voiced }),
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

const user: Actor = { userId: "g1", isGuest: false, betaGroup: "student" };
const context = { ...user, sessionId: "visit-1" };

const page: ReaderPage = {
  link: { url: "https://pub.test/post", linkType: "article" },
  frameable: true,
  articleTitle: "Consensus in practice",
  sourceName: "Pub Engineering",
  reasons: "Good prep for system design interviews: Caching.",
  saved: false,
  state: "continue_reading",
  estimatedMinutes: 9,
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

const card = { pos: "4" };

test("without a session the visitor is sent to /join", async () => {
  current.mockResolvedValue(null);
  await expect(render(card)).rejects.toThrow("redirect:/join");
  expect(reader).not.toHaveBeenCalled();
});

test.each([
  ["a bad item id", card, "5x"],
  ["a position past 200", { pos: "201" }, "5"],
  ["neither a position nor from", {}, "5"],
  ["from with a position", { ...card, from: "continue" }, "5"],
  ["an unknown from", { from: "elsewhere" }, "5"],
])("%s goes home with no lookup or events", async (_name, query, item) => {
  current.mockResolvedValue(user);
  await expect(render(query, item)).rejects.toThrow(/^redirect:\/$/);
  expect(reader).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

// A link from before ADR-0058 still names a section and a chip: both are ignored.
test("an older link's section and chip are ignored", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  const html = await render({ moment: "9", chip: "2-4", pos: "4" });
  expect(reader).toHaveBeenCalledWith("g1", "5");
  expect(html).not.toContain("moment");
  expect(html).not.toContain("chip");
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
    current.mockResolvedValue(user);
    reader.mockResolvedValue(found);
    await expect(render(card)).rejects.toThrow(
      "redirect:/out?item=5&pos=4&target=article",
    );
    expect(emit).not.toHaveBeenCalled();
    expect(recordOpen).not.toHaveBeenCalled();
  },
);

test("a feed card's open is recorded as in_app, with no outbound click", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  await render(card);
  expect(reader).toHaveBeenCalledWith("g1", "5");
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "card_opened",
    { position: 4, item_id: "5", surface: "in_app", via: "feed" },
    context,
  );
  expect(recordOpen).toHaveBeenCalledExactlyOnceWith("g1", "5");
  expect(countExploreOpen).toHaveBeenCalledExactlyOnceWith("g1", "5");
});

test("a Continue open counts as continue_clicked; a move inside the reader counts nothing", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  await render({ from: "continue" });
  expect(emit).toHaveBeenCalledExactlyOnceWith("continue_clicked", {}, context);
  emit.mockClear();
  recordOpen.mockClear();
  await render({ from: "reader" });
  expect(emit).not.toHaveBeenCalled();
  expect(recordOpen).toHaveBeenCalledExactlyOnceWith("g1", "5");
  expect(countExploreOpen).not.toHaveBeenCalled();
});

test("frames the attributed publisher page in a sandbox", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  const html = await render(card);
  // The frame mounts after hydration (so its load can't be missed); the page hands it
  // the attributed source and title.
  expect(html).toContain(
    'data-frame-src="https://pub.test/post?utm_source=interval"',
  );
  expect(html).toContain('data-frame-title="Consensus in practice"');
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

test("the header closes to the feed asking about this article, and opens the original in the browser", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  const html = await render(card);
  expect(html).toMatch(/<a href="\/\?ask=5"[^>]*>/);
  expect(html).toContain('aria-label="Close reader"');
  expect(html).toContain("pub.test");
  // The open is counted once: leaving for the browser is from=reader (an outbound click
  // only), to the article's own page.
  expect(html).toMatch(
    /<a href="\/out\?item=5&amp;from=reader&amp;target=original" target="_blank" rel="noopener noreferrer" aria-label="Open original in browser"/,
  );
});

test("the overlay: Save, the note, Quiz me, Done, and no section navigation", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  const html = await render(card);
  // The card's why stays on the card (owner, 2026-10-30, ADR-0028).
  expect(html).not.toContain(
    "Good prep for system design interviews: Caching.",
  );
  expect(html).toContain("Add a note on");
  // Save posts the feedback control and comes back to this reader.
  expect(html).toMatch(/<button[^>]*value="save"[^>]*name="control"/);
  expect(html).toContain('name="back" value="/read/5?from=reader"');
  // Done completes the article and skips the prompt.
  expect(html).toContain('name="method" value="mark_done"');
  expect(html).toMatch(
    /<svg[^>]*class="[^"]*sm:hidden[^"]*"[^>]*><path d="M5 12l5 5 9-10"><\/path><\/svg><span class="sr-only sm:not-sr-only">Done<\/span>/,
  );
  expect(html).not.toContain("Next section");
  expect(html).not.toContain('name="momentId"');
  // No live question yet: Quiz me waits, as Highlight and Listen do.
  expect(html.match(/aria-disabled="true"/g)).toHaveLength(3);
  expect(html).toContain("Quiz me. No questions yet");
});

test("a completed article says Completed, and still offers Quiz me", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue({ ...page, state: "completed" });
  offered.mockResolvedValue(new Set(["5"]));
  const html = await render(card);
  expect(html).toContain("Completed");
  expect(html).not.toContain('name="method" value="mark_done"');
  expect(html).toMatch(/<button[^>]*aria-label="Quiz me"/);
});

test("with live questions, Quiz me starts the article's quiz", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  offered.mockResolvedValue(new Set(["5"]));
  const html = await render(card);
  expect(offered).toHaveBeenCalledWith(["5"]);
  expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  expect(html).not.toContain("No questions yet");
  expect(html).toMatch(
    /<form[^>]*>(?:(?!<\/form>)[^])*name="itemId" value="5"(?:(?!<\/form>)[^])*aria-label="Quiz me"/,
  );
});

// P4-W23-S01 (owner, 2026-11-10): Listen, once a concept of the article is voiced.
test("Listen works when the article has a voiced explainer", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  voiced.mockResolvedValueOnce(["7"]);
  const html = await render(card);
  expect(voiced).toHaveBeenCalledWith("5");
  expect(html).toContain('aria-label="Listen to the AI explainers"');
  expect(html).not.toContain("Listen. No AI explainer here yet");
});

test("a saved item says Saved", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue({ ...page, saved: true });
  const html = await render(card);
  expect(html).toMatch(/<button[^>]*value="unsave"[^>]*name="control"/);
});

// Opened from the Library (owner, 2026-10-26): no feed event, and closing or Done goes
// back to the Library, which asks.
test("a Library open counts nothing and comes back to the Library", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  const html = await render({ from: "library" });
  expect(emit).not.toHaveBeenCalled();
  expect(countExploreOpen).not.toHaveBeenCalled();
  expect(recordOpen).toHaveBeenCalledExactlyOnceWith("g1", "5");
  expect(html).toMatch(
    /<a href="\/library\?ask=5"[^>]*aria-label="Close reader"/,
  );
  expect(html).toContain('name="back" value="/library"');
  // Save stays in this reader.
  expect(html).toContain('name="back" value="/read/5?from=library"');
});

// P2-W10-S03: opened from a path (Q-P2-27): no feed event, and closing or Done goes back
// to the path, which asks.
test("a path open counts nothing and comes back to the path", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  const html = await render({ from: "path", path: "6" });
  expect(emit).not.toHaveBeenCalled();
  expect(countExploreOpen).not.toHaveBeenCalled();
  expect(recordOpen).toHaveBeenCalledExactlyOnceWith("g1", "5");
  expect(html).toMatch(
    /<a href="\/paths\/6\?ask=5"[^>]*aria-label="Close reader"/,
  );
  expect(html).toContain('name="back" value="/paths/6"');
  expect(html).toContain('name="back" value="/read/5?from=path&amp;path=6"');
  // A path open without its path, or a path id on another open, goes home.
  await expect(render({ from: "path" })).rejects.toThrow("redirect:/");
  await expect(render({ from: "library", path: "6" })).rejects.toThrow(
    "redirect:/",
  );
});

// A slow page gets a slim bar below the frame, never over it (owner, 2026-10-26).
test("the slow-page bar offers the publisher's site in the browser, and closes", () => {
  const html = renderToStaticMarkup(
    <SlowBar
      domain="pub.test"
      browserHref="/out?item=5"
      onClose={() => undefined}
    />,
  );
  expect(html).toContain("Slow to load?");
  expect(html).toMatch(
    /<a href="\/out\?item=5" target="_blank" rel="noopener noreferrer"[^>]*>Open on pub\.test<\/a>/,
  );
  expect(html).toMatch(/<button[^>]*aria-label="Dismiss slow-load notice"/);
});

// Q-P2-01, P2-W7-S03: the reader's note box, on the article (ADR-0058).
test("the reader offers a note on the article, empty until one is written", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  const html = await render(card);
  expect(onItems).toHaveBeenCalledWith("g1", ["5"]);
  expect(html).toContain("Add a note");
  expect(html).toMatch(/<textarea[^>]*name="body"[^>]*><\/textarea>/);
  expect(html).not.toMatch(/<button[^>]*value="delete"/);
});

test("the article's note is shown in its box", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  onItems.mockResolvedValueOnce([{ itemId: "5", body: "On the whole thing" }]);
  const html = await render(card);
  expect(html).toContain("Your note on");
  expect(html).toContain("On the whole thing</textarea>");
});

// P7-W46 (owner, 2026-11-27): a companion's suggestion opens as a feed card does,
// counted as offered via the agent; one the frame can't take keeps that on its way out.
test("a companion's suggestion is an in-app open via the agent", async () => {
  current.mockResolvedValue(user);
  reader.mockResolvedValue(page);
  await render({ ...card, via: "agent" });
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "card_opened",
    expect.objectContaining({ surface: "in_app", via: "agent", position: 4 }),
    context,
  );
  reader.mockResolvedValue({ ...page, frameable: false });
  await expect(render({ ...card, via: "agent" })).rejects.toThrow(
    "redirect:/out?item=5&pos=4&via=agent&target=article",
  );
});
