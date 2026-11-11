import type { ListenExplainer, ListenResponse } from "@interval/api-client";
import { expect, test, vi } from "vitest";
import { createPlayer, type HlsModule, type Media } from "./player";

// P4-W23-S01 (§5G, Q-P4-12): the PWA player against a fake audio element and server.
class FakeMedia {
  src = "";
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  ended = false;
  native = true;
  private handlers = new Map<string, (() => void)[]>();
  canPlayType = (type: string) =>
    this.native && type === "application/vnd.apple.mpegurl" ? "maybe" : "";
  addEventListener(name: string, handler: () => void) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
  }
  emit(name: string) {
    for (const handler of this.handlers.get(name) ?? []) handler();
  }
  play = vi.fn(() => {
    this.paused = false;
    this.ended = false;
    this.emit("play");
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.emit("pause");
  });
  // As browsers do at the end: paused, a pause event, then ended.
  finishPlaying() {
    this.ended = true;
    this.paused = true;
    this.emit("pause");
    this.emit("ended");
  }
}

const explainer = (id: string, position = 0): ListenExplainer => ({
  explainerId: id,
  conceptId: `c${id}`,
  concept: `Concept ${id}`,
  src: `/media/explainers/c${id}/${id}/r/index.m3u8`,
  durationSeconds: 90,
  positionSeconds: position,
  sources: [],
  captions: [],
  scene: null,
});

type Call = { method: string; path: string; body: unknown };

function setup(options: { views: ListenResponse[]; native?: boolean }) {
  const media = new FakeMedia();
  media.native = options.native ?? true;
  const calls: Call[] = [];
  const views = [...options.views];
  const fetch = vi.fn((path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as unknown)
        : null;
    calls.push({ method, path, body });
    if (method === "GET") {
      const view = views.length > 1 ? views.shift() : views[0];
      return Promise.resolve(
        view === undefined
          ? new Response(null, { status: 401 })
          : Response.json(view),
      );
    }
    if (method === "POST" && path === "/api/listen")
      return Promise.resolve(Response.json({ first: "7" }, { status: 201 }));
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  };
  const handlers = new Map<string, unknown>();
  const session = {
    metadata: null as MediaMetadata | null,
    setActionHandler: (name: string, handler: unknown) =>
      void handlers.set(name, handler),
    setPositionState: vi.fn(),
  };
  const hls = { loadSource: vi.fn(), attach: vi.fn(), destroy: vi.fn() };
  const loadHls = vi.fn((): Promise<HlsModule> =>
    Promise.resolve({ isSupported: () => true, create: () => hls }),
  );
  let hide = () => {};
  const make = () =>
    createPlayer({
      media: media as unknown as Media,
      fetch: fetch as unknown as typeof globalThis.fetch,
      storage,
      session,
      metadata: (init) => init as MediaMetadata,
      loadHls,
      onPageHide: (save) => {
        hide = save;
      },
    });
  return {
    media,
    calls,
    stored,
    session,
    handlers,
    hls,
    loadHls,
    make,
    hide: () => {
      hide();
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

test("signed out or a guest (401): no player", async () => {
  const { make } = setup({ views: [] });
  const player = make();
  await player.load();
  expect(player.snapshot().status).toBe("signed-out");
});

test("Listen queues, then plays the first from its saved place, at this device's speed", async () => {
  const t = setup({
    views: [{ queue: [explainer("7", 30), explainer("8")], upNext: null }],
  });
  t.stored.set("interval.listen.speed", "1.5");
  const player = t.make();
  expect(await player.enqueue("5", "9")).toBe(true);
  expect(t.calls[0]).toEqual({
    method: "POST",
    path: "/api/listen",
    body: { itemId: "5", momentId: "9" },
  });
  expect(t.media.src).toBe("/media/explainers/c7/7/r/index.m3u8");
  expect(t.media.playbackRate).toBe(1.5);
  expect(t.calls).toContainEqual({
    method: "POST",
    path: "/api/listen/7",
    body: { action: "start" },
  });
  expect(t.media.play).toHaveBeenCalled();
  t.media.emit("loadedmetadata");
  expect(t.media.currentTime).toBe(30);
  expect(player.snapshot()).toMatchObject({
    playing: true,
    current: { explainerId: "7" },
  });
  // The lock screen's controls (Media Session).
  expect(t.session.metadata).toMatchObject({ title: "Concept 7" });
  expect([...t.handlers.keys()]).toEqual(
    expect.arrayContaining(["play", "pause", "seekto", "nexttrack"]),
  );
});

test("pausing and leaving the page save the place", async () => {
  const t = setup({ views: [{ queue: [explainer("7")], upNext: null }] });
  const player = t.make();
  await player.load();
  await player.play("7");
  t.media.emit("loadedmetadata");
  t.media.currentTime = 12.5;
  t.media.emit("timeupdate");
  t.hide();
  player.skip(15);
  expect(t.media.currentTime).toBe(27.5);
  await player.toggle();
  await settle();
  const saves = t.calls.filter(
    (c) => (c.body as { action?: string } | null)?.action === "position",
  );
  expect(saves.map((c) => c.body)).toEqual([
    // At 12.5 s: more than 10 s since the start, then the page hidden.
    { action: "position", seconds: 12.5 },
    { action: "position", seconds: 12.5 },
    { action: "position", seconds: 27.5 },
  ]);
});

test("at the end: finished, then the next in the queue; none left, Up next waits", async () => {
  const t = setup({
    views: [
      { queue: [explainer("7"), explainer("8")], upNext: null },
      { queue: [explainer("8")], upNext: null },
      { queue: [], upNext: explainer("9") },
    ],
  });
  const player = t.make();
  await player.load();
  await player.play("7");
  t.media.finishPlaying();
  await settle();
  expect(t.calls).toContainEqual({
    method: "POST",
    path: "/api/listen/7",
    body: { action: "finish" },
  });
  // The end's pause isn't saved as a place.
  expect(
    t.calls.filter(
      (c) => (c.body as { action?: string } | null)?.action === "position",
    ),
  ).toEqual([]);
  expect(player.snapshot().current?.explainerId).toBe("8");
  t.media.play.mockClear();
  t.media.finishPlaying();
  await settle();
  expect(player.snapshot()).toMatchObject({
    current: null,
    upNext: { explainerId: "9" },
  });
  // Never autoplayed (owner, 2026-11-10); a tap plays it.
  expect(t.media.play).not.toHaveBeenCalled();
  await player.play("9");
  expect(player.snapshot().current?.explainerId).toBe("9");
});

test("the speed cycles and is kept on this device", async () => {
  const t = setup({ views: [{ queue: [], upNext: null }] });
  const player = t.make();
  expect(player.snapshot().speed).toBe(1);
  player.cycleSpeed();
  player.cycleSpeed();
  expect(player.snapshot().speed).toBe(1.5);
  expect(t.media.playbackRate).toBe(1.5);
  expect(t.stored.get("interval.listen.speed")).toBe("1.5");
  await Promise.resolve();
});

test("hls.js only where HLS isn't native", async () => {
  const native = setup({ views: [{ queue: [explainer("7")], upNext: null }] });
  const one = native.make();
  await one.load();
  await one.play("7");
  expect(native.loadHls).not.toHaveBeenCalled();
  const t = setup({
    views: [{ queue: [explainer("7")], upNext: null }],
    native: false,
  });
  const player = t.make();
  await player.load();
  await player.play("7");
  expect(t.loadHls).toHaveBeenCalledTimes(1);
  expect(t.hls.loadSource).toHaveBeenCalledWith(
    "/media/explainers/c7/7/r/index.m3u8",
  );
  expect(t.hls.attach).toHaveBeenCalled();
  expect(t.media.src).toBe("");
});

test("removing the one playing stops it and drops it from the queue", async () => {
  const t = setup({
    views: [
      { queue: [explainer("7")], upNext: null },
      { queue: [], upNext: null },
    ],
  });
  const player = t.make();
  await player.load();
  await player.play("7");
  await player.remove("7");
  expect(t.calls).toContainEqual({
    method: "DELETE",
    path: "/api/listen/7",
    body: null,
  });
  expect(player.snapshot()).toMatchObject({ current: null, queue: [] });
});

test("at the end, what followed it plays, not the skipped head of the queue", async () => {
  const t = setup({
    views: [
      { queue: [explainer("6"), explainer("7"), explainer("8")], upNext: null },
      { queue: [explainer("6"), explainer("8")], upNext: null },
    ],
  });
  const player = t.make();
  await player.load();
  await player.play("7");
  t.media.finishPlaying();
  await settle();
  expect(player.snapshot().current?.explainerId).toBe("8");
});

test("a seek while cued is kept for when it plays; no place saved before it applies", async () => {
  const t = setup({ views: [{ queue: [explainer("7", 30)], upNext: null }] });
  const player = t.make();
  await player.load();
  player.seek(50);
  expect(player.snapshot().time).toBe(50);
  await player.play("7");
  // A new source starts at 0 before its metadata: nothing saved then.
  t.media.emit("timeupdate");
  t.media.emit("loadedmetadata");
  expect(t.media.currentTime).toBe(50);
  expect(
    t.calls.filter(
      (c) => (c.body as { action?: string } | null)?.action === "position",
    ),
  ).toEqual([]);
});
