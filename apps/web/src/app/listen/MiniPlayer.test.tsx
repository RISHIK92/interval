import type { ListenExplainer } from "@interval/api-client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { clock, FullPlayer, PlayerBar, visible } from "./MiniPlayer";
import type { PlayerState } from "./player";

// The drawing fetches its file in an effect; here only where it goes and with what.
vi.mock("./Scene", () => ({
  Scene: (props: { url: string; time: number }) => (
    <div data-scene={props.url} data-time={props.time} />
  ),
}));

// P4-W23-S01 (§4.1, §5G, AI-1, AI-3, wireframe 07): the mini-player and the full player.
const raft: ListenExplainer = {
  explainerId: "7",
  conceptId: "3",
  concept: "Raft",
  src: "/media/explainers/3/7/r/index.m3u8",
  durationSeconds: 95,
  positionSeconds: 0,
  sources: [
    { title: "Elections — Raft", href: "https://a.test/raft#elections" },
  ],
  captions: [],
  scene: null,
};
const state: PlayerState = {
  status: "ready",
  queue: [raft, { ...raft, explainerId: "8", concept: "Paxos" }],
  upNext: null,
  current: raft,
  playing: true,
  time: 61,
  speed: 1.25,
  dismissed: false,
  error: null,
};
const actions = {
  toggle: vi.fn(),
  seek: vi.fn(),
  skip: vi.fn(),
  next: vi.fn(),
  play: vi.fn(),
  remove: vi.fn(),
  cycleSpeed: vi.fn(),
  dismiss: vi.fn(),
};

test("shown only to an account with something to play, until closed", () => {
  expect(visible(state)).toBe(true);
  expect(visible({ ...state, status: "signed-out" })).toBe(false);
  expect(visible({ ...state, dismissed: true })).toBe(false);
  expect(visible({ ...state, current: null, queue: [] })).toBe(false);
  expect(visible({ ...state, current: null, queue: [], upNext: raft })).toBe(
    true,
  );
});

test("the bar: what's playing, labeled AI, with pause and close", () => {
  const html = renderToStaticMarkup(
    <PlayerBar state={state} actions={actions} onExpand={vi.fn()} />,
  );
  expect(html).toContain("Raft");
  expect(html).toContain("AI explainer · 1:01 / 1:35");
  expect(html).toContain('aria-label="Pause"');
  expect(html).toContain('aria-label="Close the player"');
});

test("the full player: AI under the switch, Original for later, the queue and the sources", () => {
  const html = renderToStaticMarkup(
    <FullPlayer state={state} actions={actions} onClose={vi.fn()} />,
  );
  expect(html).toContain("You’re hearing AI, not the author.");
  expect(html).toMatch(/aria-disabled="true"[^>]*>Original/);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("1.25×");
  expect(html).toContain("In your queue");
  expect(html).toContain("Paxos");
  expect(html).toContain('href="https://a.test/raft#elections"');
  expect(html).toContain(">AI</span>");
  expect(html).not.toContain("Up next");
});

test("the queue done: Up next along the graph, to tap, never autoplayed", () => {
  const done = {
    ...state,
    current: null,
    playing: false,
    queue: [],
    upNext: { ...raft, explainerId: "9", concept: "Leases" },
  };
  const bar = renderToStaticMarkup(
    <PlayerBar state={done} actions={actions} onExpand={vi.fn()} />,
  );
  expect(bar).toContain("Up next: Leases");
  expect(bar).toContain('aria-label="Play Leases"');
  const full = renderToStaticMarkup(
    <FullPlayer state={done} actions={actions} onClose={vi.fn()} />,
  );
  expect(full).toContain("Up next");
  expect(full).toContain("Leases");
  expect(actions.play).not.toHaveBeenCalled();
});

test("clock", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(95.7)).toBe("1:35");
});

// P4-W23-S03 (TTS-3): the sentence being said, its word marked.
test("captions: the current sentence, the said word in bold and underlined", () => {
  const said = {
    ...state,
    time: 1.2,
    current: {
      ...raft,
      captions: [
        { text: "Raft", start: 0, end: 0.5 },
        { text: "elects", start: 0.5, end: 1 },
        { text: "leaders.", start: 1, end: 1.5 },
        { text: "Then", start: 2, end: 2.5 },
      ],
    },
  };
  const html = renderToStaticMarkup(
    <FullPlayer state={said} actions={actions} onClose={vi.fn()} />,
  );
  expect(html).toContain('aria-hidden="true" data-testid="captions"');
  expect(html).toMatch(
    /<span class="font-semibold text-ink underline">leaders\.<\/span>/,
  );
  expect(html).toContain(">Raft<");
  expect(html).not.toContain(">Then<");
  // The whole text, still, for screen readers.
  expect(html).toContain(
    '<summary class="cursor-pointer font-semibold">Transcript</summary>',
  );
  expect(html).toContain("Raft elects leaders. Then");
});

// P4.5-W27-S01 (Q-P4.5-04): the timeline in the full player only, above the captions.
test("an approved timeline is drawn in the full player above the captions, never in the bar", () => {
  const drawn: PlayerState = {
    ...state,
    current: {
      ...raft,
      scene: "/media/explainers/3/7/scenes/a.json",
      captions: [{ text: "Raft.", start: 0, end: 1 }],
    },
  };
  const full = renderToStaticMarkup(
    <FullPlayer state={drawn} actions={actions} onClose={vi.fn()} />,
  );
  expect(full).toContain(
    'data-scene="/media/explainers/3/7/scenes/a.json" data-time="61"',
  );
  expect(full.indexOf("data-scene")).toBeLessThan(
    full.indexOf('data-testid="captions"'),
  );
  expect(
    renderToStaticMarkup(
      <PlayerBar state={drawn} actions={actions} onExpand={vi.fn()} />,
    ),
  ).not.toContain("data-scene");
  // None approved: nothing drawn.
  expect(
    renderToStaticMarkup(
      <FullPlayer state={state} actions={actions} onClose={vi.fn()} />,
    ),
  ).not.toContain("data-scene");
});
