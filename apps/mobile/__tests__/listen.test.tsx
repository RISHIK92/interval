import type { ListenExplainer, ListenResponse } from "@interval/api-client";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Linking, StyleSheet } from "react-native";
import { createListen, listen } from "../lib/listen";

// P4-W23-S02 (§4.2, §5G, §5I): the app's player, its mini-player, the full player,
// Library's audio queue and the reader's Listen.
const explainer = (id: string, position = 0): ListenExplainer => ({
  explainerId: id,
  conceptId: `c${id}`,
  concept: `Concept ${id}`,
  src: `/media/explainers/c${id}/${id}/r/index.m3u8`,
  durationSeconds: 95,
  positionSeconds: position,
  sources: [{ title: `Section ${id}`, href: `https://blog.dev/${id}` }],
  captions: [],
});

type Call = { method: string; path: string; body: unknown };

function store(views: ListenResponse[]) {
  const calls: Call[] = [];
  const left = [...views];
  const handlers: ((status: object) => void)[] = [];
  const audio = {
    play: jest.fn(),
    pause: jest.fn(),
    replace: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    setPlaybackRate: jest.fn(),
    setActiveForLockScreen: jest.fn(),
    clearLockScreenControls: jest.fn(),
    addListener: jest.fn((_: string, handler: (status: object) => void) => {
      handlers.push(handler);
      return { remove: jest.fn() };
    }),
  };
  const api = jest.fn(
    (path: string, init: { method: string; body?: unknown }) => {
      calls.push({ method: init.method, path, body: init.body ?? null });
      if (init.method === "GET") {
        const view = left.length > 1 ? left.shift() : left[0];
        return Promise.resolve(Response.json(view));
      }
      if (path === "/api/listen")
        return Promise.resolve(Response.json({ first: "7" }, { status: 201 }));
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  );
  let background = () => {};
  const listen = createListen({
    audio: audio,
    api,
    setMode: jest.fn(() => Promise.resolve()),
    onBackground: (save) => {
      background = save;
    },
  });
  const status = (s: object) => {
    for (const handler of handlers)
      handler({
        isLoaded: true,
        playing: false,
        didJustFinish: false,
        currentTime: 0,
        duration: 95,
        error: null,
        ...s,
      });
  };
  return {
    listen,
    audio,
    calls,
    status,
    background: () => {
      background();
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const positions = (calls: Call[]) =>
  calls.filter(
    (c) => (c.body as { action?: string } | null)?.action === "position",
  );

test("Listen queues and plays the first from its saved place, on the lock screen", async () => {
  const t = store([
    { queue: [explainer("7", 30), explainer("8")], upNext: null },
  ]);
  expect(await t.listen.enqueue("5", "9")).toBe(true);
  expect(t.calls[0]).toEqual({
    method: "POST",
    path: "/api/listen",
    body: { itemId: "5", momentId: "9" },
  });
  expect(t.audio.replace).toHaveBeenCalledWith({
    uri: "http://localhost:3100/media/explainers/c7/7/r/index.m3u8",
  });
  expect(t.calls).toContainEqual({
    method: "POST",
    path: "/api/listen/7",
    body: { action: "start" },
  });
  expect(t.audio.play).toHaveBeenCalled();
  expect(t.audio.setActiveForLockScreen).toHaveBeenCalledWith(
    true,
    { title: "Concept 7", artist: "Interval · AI explainer" },
    {
      showSeekForward: true,
      showSeekBackward: true,
      seekForwardIntervalSeconds: 15,
      seekBackwardIntervalSeconds: 15,
    },
  );
  // Loaded: the saved place. Until its seek lands the element says 0, which is
  // neither shown nor saved.
  t.status({ playing: true, currentTime: 0 });
  expect(t.audio.seekTo).toHaveBeenCalledWith(30);
  expect(t.listen.snapshot().time).toBe(30);
  t.status({ playing: true, currentTime: 0 });
  expect(t.listen.snapshot().time).toBe(30);
  expect(positions(t.calls)).toEqual([]);
  await settle();
  t.status({ playing: true, currentTime: 31 });
  expect(t.listen.snapshot().time).toBe(31);
});

test("a late status from the previous source doesn't take the saved place", async () => {
  const t = store([
    { queue: [explainer("7"), explainer("8", 40)], upNext: null },
  ]);
  await t.listen.load();
  await t.listen.play("7");
  t.status({ playing: true, currentTime: 0 });
  await t.listen.play("8");
  // Still the old source (another length), loaded: not the new one yet.
  t.status({ playing: true, currentTime: 12, duration: 61 });
  expect(t.audio.seekTo).not.toHaveBeenCalled();
  t.status({ isLoaded: false, playing: false });
  t.status({ playing: true, currentTime: 0, duration: 61 });
  expect(t.audio.seekTo).toHaveBeenCalledWith(40);
});

test("a playback error is said, not swallowed", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const t = store([{ queue: [explainer("7")], upNext: null }]);
  await t.listen.load();
  await t.listen.play("7");
  t.status({ isLoaded: false, error: "404 on the playlist" });
  expect(t.listen.snapshot().error).toBe(
    "Something went wrong with the player. Try again.",
  );
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("a pause and going to the background keep the place; the end doesn't", async () => {
  const t = store([
    { queue: [explainer("7"), explainer("8")], upNext: null },
    { queue: [explainer("8")], upNext: null },
  ]);
  await t.listen.load();
  await t.listen.play("7");
  t.status({ playing: true, currentTime: 0 });
  t.status({ playing: true, currentTime: 4 });
  t.background();
  t.status({ playing: false, currentTime: 6 });
  await settle();
  expect(positions(t.calls).map((c) => c.body)).toEqual([
    { action: "position", seconds: 4 },
    { action: "position", seconds: 6 },
  ]);
  await t.listen.play("7");
  t.status({ playing: true, currentTime: 94 });
  t.status({ playing: false, currentTime: 95, didJustFinish: true });
  await settle();
  expect(t.calls).toContainEqual({
    method: "POST",
    path: "/api/listen/7",
    body: { action: "finish" },
  });
  // The 10-second save at 94, none at the end.
  expect(positions(t.calls).map((c) => c.body)).toContainEqual({
    action: "position",
    seconds: 94,
  });
  expect(positions(t.calls)).toHaveLength(3);
  // What followed it plays next.
  expect(t.listen.snapshot().current?.explainerId).toBe("8");
});

test("the queue done: Up next waits for a tap", async () => {
  const t = store([
    { queue: [explainer("7")], upNext: null },
    { queue: [], upNext: explainer("9") },
  ]);
  await t.listen.load();
  await t.listen.play("7");
  t.status({ playing: true });
  t.audio.play.mockClear();
  t.status({ didJustFinish: true });
  await settle();
  expect(t.listen.snapshot()).toMatchObject({
    current: null,
    upNext: { explainerId: "9" },
  });
  expect(t.audio.play).not.toHaveBeenCalled();
  // Nothing current: the lock screen can't play what the app no longer shows.
  expect(t.audio.clearLockScreenControls).toHaveBeenCalled();
});

test("the speed cycles; a seek while cued is kept for when it plays", async () => {
  const t = store([{ queue: [explainer("7", 30)], upNext: null }]);
  await t.listen.load();
  t.listen.cycleSpeed();
  expect(t.audio.setPlaybackRate).toHaveBeenLastCalledWith(1.25);
  t.listen.seek(50);
  await t.listen.play("7");
  t.status({ playing: true });
  expect(t.audio.seekTo).toHaveBeenCalledWith(50);
  expect(t.audio.setPlaybackRate).toHaveBeenLastCalledWith(1.25);
});

// The screens, through the router, against a served queue.
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const serve = (view: ListenResponse) => {
  fetchMock.mockImplementation((url, init) => {
    const path = url.replace("http://localhost:3100", "");
    const method = init.method ?? "GET";
    if (method === "GET" && path === "/api/listen")
      return Promise.resolve(Response.json(view));
    return Promise.resolve(new Response(null, { status: 204 }));
  });
};
beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // The app's one player outlives a screen: each test starts it afresh.
  listen().reset();
});
afterEach(() => {
  jest.clearAllMocks();
});

test("Library lists the queue with Play and Remove; the mini-player sits on the tabs", async () => {
  serve({ queue: [explainer("7", 30)], upNext: null });
  await renderRouter("./app", { initialUrl: "/library" });
  expect(
    await screen.findByText("AI explainer · 1:35 · at 0:30"),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Play Concept 7" }),
  ).toBeOnTheScreen();
  // The mini-player cues the queue's head.
  expect(
    screen.getByRole("button", {
      name: /^Open the player\. Concept 7, AI explainer$/,
    }),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Remove Concept 7" }),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:3100/api/listen/7",
    expect.objectContaining({ method: "DELETE" }),
  );
});

test("the full player: AI, not the author; Original for later; the sources", async () => {
  serve({ queue: [explainer("7")], upNext: null });
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  await renderRouter("./app", { initialUrl: "/library" });
  await fireEvent.press(
    await screen.findByRole("button", {
      name: /^Open the player\. Concept 7, AI explainer$/,
    }),
  );
  expect(
    await screen.findByText("You’re hearing AI, not the author."),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText("Original. Coming later")).toBeDisabled();
  await fireEvent.press(screen.getByRole("link", { name: "Section 7" }));
  expect(open).toHaveBeenCalledWith("https://blog.dev/7");
});

test("the reader's Listen queues what's shown and opens the player", async () => {
  fetchMock.mockImplementation((url, init) => {
    const path = url.replace("http://localhost:3100", "");
    const method = init.method ?? "GET";
    if (path.startsWith("/api/read/5"))
      return Promise.resolve(
        Response.json({
          url: "https://blog.dev/raft#election",
          inApp: true,
          title: "Raft",
          domain: "blog.dev",
          saved: false,
          reached: "9",
          nextMomentId: null,
          note: null,
          testable: false,
          listen: true,
          measure: null,
        }),
      );
    if (method === "POST" && path === "/api/listen")
      return Promise.resolve(Response.json({ first: "7" }, { status: 201 }));
    if (method === "GET" && path === "/api/listen")
      return Promise.resolve(
        Response.json({ queue: [explainer("7")], upNext: null }),
      );
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  await renderRouter("./app", {
    initialUrl: "/read/5?moment=9&chip=3-8&pos=2",
  });
  await screen.findByText("blog.dev");
  await fireEvent.press(screen.getByRole("button", { name: "Listen" }));
  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:3100/api/listen",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ itemId: "5", momentId: "9" }),
    }),
  );
  expect(
    await screen.findByText("You’re hearing AI, not the author."),
  ).toBeOnTheScreen();
});

// P4-W23-S03 (TTS-3): the sentence being said, its word in bold and underlined.
test("the full player shows captions, the said word marked", async () => {
  serve({
    queue: [
      {
        ...explainer("7"),
        captions: [
          { text: "Raft", start: 0, end: 0.4 },
          { text: "elects", start: 0.4, end: 0.8 },
          { text: "leaders.", start: 0.8, end: 1.2 },
          { text: "Then", start: 2, end: 2.5 },
        ],
      },
    ],
    upNext: null,
  });
  await renderRouter("./app", { initialUrl: "/library" });
  await fireEvent.press(
    await screen.findByRole("button", {
      name: /^Open the player\. Concept 7, AI explainer$/,
    }),
  );
  await screen.findByTestId("captions", { includeHiddenElements: true });
  const hidden = { includeHiddenElements: true };
  expect(screen.getByText("leaders.", hidden)).toBeTruthy();
  expect(screen.queryByText("Then", hidden)).toBeNull();
  const said = screen.getByText("Raft", hidden);
  expect(StyleSheet.flatten(said.props.style)).toMatchObject({
    fontWeight: "700",
    textDecorationLine: "underline",
  });
  // The whole text, for screen readers, behind Transcript.
  await fireEvent.press(screen.getByRole("button", { name: "Transcript" }));
  expect(screen.getByText("Raft elects leaders. Then")).toBeOnTheScreen();
});
