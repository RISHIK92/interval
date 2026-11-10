import {
  type ListenExplainer,
  ListenQueued,
  ListenResponse,
} from "@interval/api-client";

// P4-W23-S01 (§5G, §4.1, Q-P4-12): the PWA's one player, shared by the mini-player,
// the full player, the reader's Listen and Library's queue. One audio element outside
// the page tree, so client navigation never stops it. The queue and saved positions
// live on the server (shared with the app, W23-S02); the speed is this device's.

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75] as const;
const SPEED_KEY = "interval.listen.speed";
// Saved this often while playing, and on every pause and when the page goes away.
const SAVE_EVERY_S = 10;
export const SKIP_SECONDS = 15;
const HLS_TYPE = "application/vnd.apple.mpegurl";

export type PlayerState = {
  // signed-out: the server said 401 (a guest or no session): no player at all.
  status: "idle" | "signed-out" | "ready";
  queue: ListenExplainer[];
  upNext: ListenExplainer | null;
  current: ListenExplainer | null;
  playing: boolean;
  time: number;
  speed: number;
  // Hidden by the listener until something is queued or played again.
  dismissed: boolean;
  error: string | null;
};

export type Media = Pick<
  HTMLMediaElement,
  | "src"
  | "currentTime"
  | "playbackRate"
  | "paused"
  | "ended"
  | "play"
  | "pause"
  | "canPlayType"
  | "addEventListener"
>;
type HlsLike = {
  loadSource(src: string): void;
  // Onto the player's own audio element.
  attach(): void;
  destroy(): void;
};
export type HlsModule = {
  isSupported(): boolean;
  // A fatal error (network, media) doesn't always reach the element's error event.
  create(onFatal: (detail: string) => void): HlsLike;
};
type Session = Pick<MediaSession, "setActionHandler" | "setPositionState"> & {
  metadata: MediaMetadata | null;
};

export type PlayerDeps = {
  media: Media;
  fetch: typeof fetch;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  session: Session | null;
  // Media Session's metadata; absent where the API is.
  metadata: ((init: MediaMetadataInit) => MediaMetadata) | null;
  // hls.js, loaded only where HLS isn't native (Chrome on desktop).
  loadHls: () => Promise<HlsModule>;
  onPageHide: (save: () => void) => void;
};

export function createPlayer(deps: PlayerDeps) {
  const { media } = deps;
  let state: PlayerState = {
    status: "idle",
    queue: [],
    upNext: null,
    current: null,
    playing: false,
    time: 0,
    speed: readSpeed(),
    dismissed: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  let hls: HlsLike | null = null;
  let attached: string | null = null;
  let pendingSeek: number | null = null;
  let savedAt = 0;

  function set(patch: Partial<PlayerState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function readSpeed(): number {
    try {
      const saved = Number(deps.storage?.getItem(SPEED_KEY));
      return (SPEEDS as readonly number[]).includes(saved) ? saved : 1;
    } catch {
      // Storage blocked (a private window): the default speed is fine.
      return 1;
    }
  }

  async function send(
    path: string,
    method: "GET" | "POST" | "DELETE",
    body?: unknown,
    keepalive = false,
  ): Promise<Response> {
    const response = await deps.fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      keepalive,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok && response.status !== 401 && response.status !== 404) {
      throw new Error(`listen: ${method} ${path} ${String(response.status)}`);
    }
    return response;
  }

  async function load(): Promise<void> {
    const response = await send("/api/listen", "GET");
    if (response.status === 401) {
      set({ status: "signed-out" });
      return;
    }
    const view = ListenResponse.parse(await response.json());
    // The one playing keeps playing even once it has left the queue (finished
    // elsewhere, or Up next); otherwise the queue's head is cued, not played.
    const current =
      state.current === null
        ? (view.queue[0] ?? null)
        : (view.queue.find(
            (q) => q.explainerId === state.current?.explainerId,
          ) ?? state.current);
    set({
      status: "ready",
      queue: view.queue,
      upNext: view.upNext,
      current,
      time:
        state.current === null ? (current?.positionSeconds ?? 0) : state.time,
    });
  }

  async function attach(src: string): Promise<void> {
    if (attached === src) return;
    // Nothing attached until the new source is: a failure below leaves none claimed.
    attached = null;
    hls?.destroy();
    hls = null;
    if (media.canPlayType(HLS_TYPE) !== "") {
      media.src = src;
    } else {
      const Hls = await deps.loadHls();
      if (!Hls.isSupported()) throw new Error("this browser can't play HLS");
      hls = Hls.create((detail) => {
        report(new Error(`listen: hls.js failed (${detail}) on ${src}`));
      });
      hls.loadSource(src);
      hls.attach();
    }
    attached = src;
  }

  function savePosition(keepalive = false) {
    const current = state.current;
    // Not before the saved place is applied: until then the element says 0.
    if (current === null || attached !== current.src || pendingSeek !== null)
      return;
    savedAt = media.currentTime;
    void send(
      `/api/listen/${current.explainerId}`,
      "POST",
      { action: "position", seconds: Math.max(0, media.currentTime) },
      keepalive,
    ).catch(report);
  }

  function report(error: unknown) {
    console.error(error);
    set({ error: "Something went wrong with the player. Try again." });
  }

  function announce(explainer: ListenExplainer) {
    const session = deps.session;
    if (session === null) return;
    if (deps.metadata !== null) {
      session.metadata = deps.metadata({
        title: explainer.concept,
        artist: "Interval · AI explainer",
        artwork: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      });
    }
    session.setActionHandler("play", () => {
      if (media.paused) void toggle();
    });
    session.setActionHandler("pause", () => {
      media.pause();
    });
    session.setActionHandler("seekbackward", () => {
      skip(-SKIP_SECONDS);
    });
    session.setActionHandler("seekforward", () => {
      skip(SKIP_SECONDS);
    });
    session.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) seek(details.seekTime);
    });
    session.setActionHandler("nexttrack", () => void next());
  }

  async function play(explainerId: string): Promise<void> {
    const explainer =
      state.queue.find((q) => q.explainerId === explainerId) ??
      (state.upNext?.explainerId === explainerId ? state.upNext : null);
    if (explainer === null) return;
    try {
      if (state.current?.explainerId !== explainerId && state.playing) {
        savePosition();
      }
      set({
        current: explainer,
        dismissed: false,
        error: null,
        time:
          state.current?.explainerId === explainerId
            ? state.time
            : explainer.positionSeconds,
      });
      const fresh = attached !== explainer.src;
      // The saved place (or where the listener moved it while it was cued), applied
      // once the media knows its length.
      if (fresh) {
        pendingSeek = state.time;
        savedAt = state.time;
      }
      await attach(explainer.src);
      media.playbackRate = state.speed;
      await send(`/api/listen/${explainerId}`, "POST", { action: "start" });
      await media.play();
      announce(explainer);
    } catch (error) {
      report(error);
    }
  }

  async function toggle(): Promise<void> {
    const current = state.current;
    if (current === null) return;
    if (media.paused) {
      await play(current.explainerId);
    } else {
      media.pause();
    }
  }

  // Cued and not yet loaded, the place is kept for when it plays; the element may
  // still hold the previous explainer.
  function seek(seconds: number) {
    const current = state.current;
    if (current === null) return;
    const to = Math.min(Math.max(0, seconds), current.durationSeconds);
    if (attached !== current.src || pendingSeek !== null) {
      if (attached === current.src) pendingSeek = to;
    } else {
      media.currentTime = to;
    }
    set({ time: to });
  }

  function skip(by: number) {
    seek(state.time + by);
  }

  // The next in the queue after the current one; none left, Up next waits for a tap.
  async function next(): Promise<void> {
    const at = state.queue.findIndex(
      (q) => q.explainerId === state.current?.explainerId,
    );
    const following = state.queue[at + 1] ?? null;
    if (following !== null) await play(following.explainerId);
  }

  async function remove(explainerId: string): Promise<void> {
    try {
      if (state.current?.explainerId === explainerId) {
        media.pause();
        set({ current: null, playing: false, time: 0 });
      }
      await send(`/api/listen/${explainerId}`, "DELETE");
      await load();
    } catch (error) {
      report(error);
    }
  }

  async function enqueue(
    itemId: string,
    momentId: string | null,
  ): Promise<boolean> {
    try {
      const response = await send("/api/listen", "POST", {
        itemId,
        ...(momentId === null ? {} : { momentId }),
      });
      if (!response.ok) return false;
      const { first } = ListenQueued.parse(await response.json());
      await load();
      await play(first);
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }

  function cycleSpeed() {
    const at = (SPEEDS as readonly number[]).indexOf(state.speed);
    const speed = SPEEDS[(at + 1) % SPEEDS.length] ?? 1;
    media.playbackRate = speed;
    try {
      deps.storage?.setItem(SPEED_KEY, String(speed));
    } catch {
      // Not kept on this device (storage blocked); it still applies now.
    }
    set({ speed });
  }

  function dismiss() {
    media.pause();
    set({ dismissed: true });
  }

  media.addEventListener("loadedmetadata", () => {
    if (pendingSeek !== null) media.currentTime = pendingSeek;
    pendingSeek = null;
  });
  media.addEventListener("play", () => {
    set({ playing: true });
  });
  // At the end the browser pauses before "ended": that's a finish, not a place.
  media.addEventListener("pause", () => {
    set({ playing: false });
    if (!media.ended) savePosition();
  });
  media.addEventListener("timeupdate", () => {
    set({ time: media.currentTime });
    if (Math.abs(media.currentTime - savedAt) >= SAVE_EVERY_S) savePosition();
    const length = state.current?.durationSeconds;
    if (deps.session !== null && length !== undefined) {
      try {
        deps.session.setPositionState({
          duration: length,
          playbackRate: state.speed,
          position: Math.min(media.currentTime, length),
        });
      } catch {
        // A position past the stored length (rounding): the lock screen skips a beat.
      }
    }
  });
  media.addEventListener("ended", () => {
    const current = state.current;
    if (current === null) return;
    // What followed it in the queue, which plays next (not the queue's head, which the
    // listener may have skipped).
    const at = state.queue.findIndex(
      (q) => q.explainerId === current.explainerId,
    );
    const following = at === -1 ? undefined : state.queue[at + 1];
    void (async () => {
      try {
        await send(`/api/listen/${current.explainerId}`, "POST", {
          action: "finish",
        });
        const after = state.queue.filter(
          (q) => q.explainerId !== current.explainerId,
        );
        set({ current: null, playing: false, time: 0, queue: after });
        await load();
        if (
          following !== undefined &&
          state.queue.some((q) => q.explainerId === following.explainerId)
        ) {
          await play(following.explainerId);
        }
      } catch (error) {
        report(error);
      }
    })();
  });
  media.addEventListener("error", () => {
    report(new Error(`listen: the audio failed to load (${attached ?? ""})`));
  });
  deps.onPageHide(() => {
    if (state.playing) savePosition(true);
  });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => state,
    load,
    play,
    toggle,
    seek,
    skip,
    next,
    remove,
    enqueue,
    cycleSpeed,
    dismiss,
  };
}

export type Player = ReturnType<typeof createPlayer>;

let shared: Player | null = null;

// The browser's one player, made on first use.
export function player(): Player {
  if (shared !== null) return shared;
  const audio = new Audio();
  shared = createPlayer({
    media: audio,
    fetch: (input, init) => fetch(input, init),
    storage: (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
    session: "mediaSession" in navigator ? navigator.mediaSession : null,
    metadata:
      typeof MediaMetadata === "undefined"
        ? null
        : (init) => new MediaMetadata(init),
    loadHls: async () => {
      const { default: Hls } = await import("hls.js");
      return {
        isSupported: () => Hls.isSupported(),
        create: (onFatal) => {
          const hls = new Hls();
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) onFatal(`${data.type}: ${data.details}`);
          });
          return {
            loadSource: (src) => {
              hls.loadSource(src);
            },
            attach: () => {
              hls.attachMedia(audio);
            },
            destroy: () => {
              hls.destroy();
            },
          };
        },
      };
    },
    onPageHide: (save) => {
      window.addEventListener("pagehide", save);
    },
  });
  return shared;
}
