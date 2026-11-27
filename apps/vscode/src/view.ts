import type { AgentStatus } from "@interval/api-client";
import type { StatusResult } from "./api";

// What the status-bar item can be showing. A problem goes in the tooltip, never in a
// popup: the item is redrawn on every poll.
export type BarState =
  | { readonly kind: "signedOut" }
  | { readonly kind: "noSite" }
  | { readonly kind: "badSite"; readonly reason: string }
  | { readonly kind: "checking" }
  | StatusResult;

type Shown = { readonly text: string; readonly tooltip: string };

const SIGN_IN =
  'Run "Interval: Sign in" with a device token from Interval\'s Profile → Agent hook.';
const OPEN = "Click for a quick session that fits the wait.";

export function show(state: BarState): Shown {
  switch (state.kind) {
    case "signedOut":
      return { text: "$(book) Interval: sign in", tooltip: SIGN_IN };
    case "noSite":
      return {
        text: "$(book) Interval: sign in",
        tooltip: "Set interval.url to your Interval site, then sign in.",
      };
    case "badSite":
      return { text: "$(warning) Interval", tooltip: state.reason };
    case "checking":
      return { text: "$(book) Interval", tooltip: "Checking your agent…" };
    case "ok":
      return showTask(state.status.task);
    case "refused":
      return {
        text: "$(warning) Interval: sign in",
        tooltip: `Interval refused the device token (revoked?). ${SIGN_IN}`,
      };
    case "plan":
      return {
        text: "$(book) Interval",
        tooltip: "Your Interval plan doesn't include the agent hook.",
      };
    case "rateLimited":
      return {
        text: "$(book) Interval",
        tooltip: `Interval asked for fewer checks; the next is in ${String(state.retryAfterSeconds)}s.`,
      };
    case "redirect":
      return {
        text: "$(warning) Interval",
        tooltip: "interval.url redirects: set it to the site's final address.",
      };
    case "failed":
      return {
        text: "$(warning) Interval",
        tooltip: `Couldn't check your agent: ${state.detail}.`,
      };
  }
}

function showTask(task: AgentStatus["task"]): Shown {
  switch (task.state) {
    case "running":
      return {
        text: `$(sync~spin) Agent ${minutes(task.seconds)} · Interval`,
        tooltip: `Your agent has been working for ${elapsed(task.seconds)}. ${OPEN}`,
      };
    case "finished":
      return {
        text: "$(check) Agent done",
        tooltip: `Your agent finished. ${OPEN}`,
      };
    case "idle":
      return { text: "$(book) Interval", tooltip: `Interval: ${OPEN}` };
  }
}

function minutes(seconds: number): string {
  return seconds < 60 ? "<1m" : `${String(Math.floor(seconds / 60))}m`;
}

function elapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}
