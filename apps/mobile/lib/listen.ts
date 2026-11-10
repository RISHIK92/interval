import {
  type ListenExplainer,
  ListenQueued,
  ListenResponse,
} from "@interval/api-client";
import {
  type AudioPlayer,
  type AudioStatus,
  createAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";
import { AppState } from "react-native";
import { api, got } from "./api";
import { SITE } from "./auth";

// P4-W23-S02 (§4.2, §5G): the app's player, as the PWA's (apps/web/src/app/listen/
// player.ts): the queue and saved places on the server, shared with the web; background
// playback and the lock screen through expo-audio (owner, 2026-11-10, in place of
// react-native-track-player). One player for the whole app, outside the screens.

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75] as const;
export const SKIP_SECONDS = 15;
const SAVE_EVERY_S = 10;

export type ListenState = {
  status: "idle" | "ready" | "failed";
  queue: ListenExplainer[];
  upNext: ListenExplainer | null;
  current: ListenExplainer | null;
  playing: boolean;
  time: number;
  speed: number;
  error: string | null;
};

type Audio = Pick<
  AudioPlayer,
  | "play"
  | "pause"
  | "replace"
  | "seekTo"
  | "setPlaybackRate"
  | "setActiveForLockScreen"
  | "clearLockScreenControls"
  | "addListener"
>;

type ListenDeps = {
  audio: Audio;
  api: typeof api;
  // Plays with the ringer off, in the background, and holds the audio focus (needed for
  // the lock screen's controls).
  setMode: () => Promise<void>;
  onBackground: (save: () => void) => void;
};

export function createListen(deps: ListenDeps) {
  const { audio } = deps;
  const initial: ListenState = {
    status: "idle",
    queue: [],
    upNext: null,
    current: null,
    playing: false,
    time: 0,
    // shortcut: kept for this run of the app only (the app has no non-secret local
    // store yet); persist it when one comes.
    speed: 1,
    error: null,
  };
  let state = initial;
  const listeners = new Set<() => void>();
  let loaded: string | null = null;
  // The saved place waits for the new source to load (a status from the old one can
  // still arrive after replace), then for its seek to land: until both, the element
  // reports 0, which must be neither shown nor saved.
  let pendingSeek: number | null = null;
  let sawUnloaded = false;
  let seeking = false;
  let savedAt = 0;
  let moded = false;

  function set(patch: Partial<ListenState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function report(error: unknown) {
    console.warn("listen:", error);
    set({ error: "Something went wrong with the player. Try again." });
  }

  // Never throws: the mini-player and Library call it without waiting, and a failed
  // read (offline) shows as "failed".
  let reads = 0;
  async function load(): Promise<void> {
    // Two reads at once (Library and the mini-player): only the latest one counts.
    reads += 1;
    const read = reads;
    const view = await deps
      .api("/api/listen", { method: "GET" })
      .then((response) => got(response, ListenResponse, "listen"))
      .catch((error: unknown) => {
        console.warn("listen: not read", error);
        return { status: "failed" as const };
      });
    if (read !== reads) return;
    if (view.status !== "ok") {
      // A refresh that fails keeps the queue already shown (and the one playing).
      if (state.status === "ready") report(new Error("the queue wasn't read"));
      else set({ status: "failed" });
      return;
    }
    const { queue, upNext } = view.value;
    const current =
      state.current === null
        ? (queue[0] ?? null)
        : (queue.find((q) => q.explainerId === state.current?.explainerId) ??
          state.current);
    set({
      status: "ready",
      queue,
      upNext,
      current,
      error: null,
      time:
        state.current === null ? (current?.positionSeconds ?? 0) : state.time,
    });
  }

  async function post(explainerId: string, body: object): Promise<void> {
    const response = await deps.api(`/api/listen/${explainerId}`, {
      method: "POST",
      body,
    });
    // 404: the listen isn't under way any more (finished elsewhere); nothing to keep.
    if (!response.ok && response.status !== 404) {
      throw new Error(`POST ${explainerId}: ${String(response.status)}`);
    }
  }

  function savePosition() {
    const current = state.current;
    if (
      current === null ||
      loaded !== current.src ||
      pendingSeek !== null ||
      seeking
    )
      return;
    savedAt = state.time;
    void post(current.explainerId, {
      action: "position",
      seconds: Math.max(0, state.time),
    }).catch(report);
  }

  async function play(explainerId: string): Promise<void> {
    const explainer =
      state.queue.find((q) => q.explainerId === explainerId) ??
      (state.upNext?.explainerId === explainerId ? state.upNext : null);
    if (explainer === null) return;
    try {
      if (!moded) {
        await deps.setMode();
        moded = true;
      }
      if (state.current?.explainerId !== explainerId && state.playing) {
        savePosition();
      }
      const time =
        state.current?.explainerId === explainerId
          ? state.time
          : explainer.positionSeconds;
      set({ current: explainer, error: null, time });
      if (loaded !== explainer.src) {
        // The saved place (or where it was moved while cued), once it has loaded.
        pendingSeek = time;
        sawUnloaded = false;
        savedAt = time;
        audio.replace({ uri: `${SITE}${explainer.src}` });
        loaded = explainer.src;
      }
      audio.setPlaybackRate(state.speed);
      await post(explainerId, { action: "start" });
      audio.play();
      // Android stops background audio after a few minutes without it.
      audio.setActiveForLockScreen(
        true,
        { title: explainer.concept, artist: "Interval · AI explainer" },
        {
          showSeekForward: true,
          showSeekBackward: true,
          seekForwardIntervalSeconds: SKIP_SECONDS,
          seekBackwardIntervalSeconds: SKIP_SECONDS,
        },
      );
    } catch (error) {
      report(error);
    }
  }

  async function toggle(): Promise<void> {
    const current = state.current;
    if (current === null) return;
    if (state.playing) audio.pause();
    else await play(current.explainerId);
  }

  function seek(seconds: number) {
    const current = state.current;
    if (current === null) return;
    const to = Math.min(Math.max(0, seconds), current.durationSeconds);
    if (loaded !== current.src || pendingSeek !== null) {
      if (loaded === current.src) pendingSeek = to;
    } else {
      seekTo(to);
    }
    set({ time: to });
  }

  function seekTo(to: number) {
    seeking = true;
    audio.seekTo(to).then(
      () => {
        seeking = false;
      },
      (error: unknown) => {
        seeking = false;
        report(error);
      },
    );
  }

  // Nothing current: the lock screen's controls go, so they can't play what the app
  // no longer shows, and a later play loads it afresh from its saved place.
  function stop() {
    audio.pause();
    audio.clearLockScreenControls();
    loaded = null;
    pendingSeek = null;
  }

  function skip(by: number) {
    seek(state.time + by);
  }

  async function remove(explainerId: string): Promise<void> {
    try {
      if (state.current?.explainerId === explainerId) {
        stop();
        set({ current: null, playing: false, time: 0 });
      }
      const response = await deps.api(`/api/listen/${explainerId}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404)
        throw new Error(`DELETE ${explainerId}: ${String(response.status)}`);
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
      const queued = await got(
        await deps.api("/api/listen", {
          method: "POST",
          body: { itemId, ...(momentId === null ? {} : { momentId }) },
        }),
        ListenQueued,
        "listen: queue",
      );
      if (queued.status !== "ok") return false;
      await load();
      if (!state.queue.some((q) => q.explainerId === queued.value.first))
        return false;
      await play(queued.value.first);
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }

  function cycleSpeed() {
    const at = (SPEEDS as readonly number[]).indexOf(state.speed);
    const speed = SPEEDS[(at + 1) % SPEEDS.length] ?? 1;
    audio.setPlaybackRate(speed);
    set({ speed });
  }

  async function finished(current: ListenExplainer): Promise<void> {
    // What followed it plays next, not the queue's head (which may have been skipped);
    // none left, Up next waits for a tap.
    const at = state.queue.findIndex(
      (q) => q.explainerId === current.explainerId,
    );
    const following = at === -1 ? undefined : state.queue[at + 1];
    try {
      await post(current.explainerId, { action: "finish" });
      stop();
      set({
        current: null,
        playing: false,
        time: 0,
        queue: state.queue.filter((q) => q.explainerId !== current.explainerId),
      });
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
  }

  audio.addListener("playbackStatusUpdate", (status: AudioStatus) => {
    const current = state.current;
    if (status.error !== null) report(new Error(`playback: ${status.error}`));
    if (!status.isLoaded) sawUnloaded = true;
    if (
      pendingSeek !== null &&
      current !== null &&
      status.isLoaded &&
      // The new source, not a late status from the old one.
      (sawUnloaded || Math.abs(status.duration - current.durationSeconds) < 1)
    ) {
      const to = pendingSeek;
      pendingSeek = null;
      if (to > 0) seekTo(to);
    }
    if (status.didJustFinish && current !== null) {
      void finished(current);
      return;
    }
    const wasPlaying = state.playing;
    if (pendingSeek === null && !seeking) set({ time: status.currentTime });
    if (wasPlaying !== status.playing) set({ playing: status.playing });
    // A pause (not the end, handled above) keeps the place.
    if (wasPlaying && !status.playing) savePosition();
    else if (Math.abs(state.time - savedAt) >= SAVE_EVERY_S) savePosition();
  });
  deps.onBackground(() => {
    if (state.playing) savePosition();
  });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => state,
    // Sign-out: nothing of this account's keeps playing or shows for the next.
    reset() {
      stop();
      state = initial;
      for (const listener of listeners) listener();
    },
    load,
    play,
    toggle,
    seek,
    skip,
    remove,
    enqueue,
    cycleSpeed,
  };
}

type Listen = ReturnType<typeof createListen>;

let shared: Listen | null = null;

export function listen(): Listen {
  shared ??= createListen({
    // The session stays active after a pause, so the lock screen's Play can resume.
    audio: createAudioPlayer(null, {
      updateInterval: 500,
      keepAudioSessionActive: true,
    }),
    api,
    setMode: () =>
      setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: "doNotMix",
      }),
    onBackground: (save) => {
      AppState.addEventListener("change", (next) => {
        if (next !== "active") save();
      });
    },
  });
  return shared;
}
