import { expect, test } from "vitest";
import type { AgentStatus } from "@interval/api-client";
import { type BarState, show } from "./view";

function status(task: AgentStatus["task"]): BarState {
  return { kind: "ok", status: { task, chip: "3-8", suggestions: [] } };
}

test("the agent's state is the label", () => {
  expect(
    show(
      status({
        state: "running",
        startedAt: "2026-11-27T10:00:00Z",
        seconds: 130,
      }),
    ),
  ).toEqual({
    text: "$(sync~spin) Agent 2m · Interval",
    tooltip:
      "Your agent has been working for 2m 10s. Click for a quick session that fits the wait.",
  });
  expect(
    show(
      status({
        state: "running",
        startedAt: "2026-11-27T10:00:00Z",
        seconds: 45,
      }),
    ).text,
  ).toBe("$(sync~spin) Agent <1m · Interval");
  expect(
    show(status({ state: "finished", finishedAt: "2026-11-27T10:05:00Z" }))
      .text,
  ).toBe("$(check) Agent done");
  expect(show(status({ state: "idle" })).text).toBe("$(book) Interval");
});

test("signed out, or no site yet, asks to sign in", () => {
  expect(show({ kind: "signedOut" }).text).toBe("$(book) Interval: sign in");
  expect(show({ kind: "signedOut" }).tooltip).toContain("Interval: Sign in");
  expect(show({ kind: "noSite" }).text).toBe("$(book) Interval: sign in");
  expect(show({ kind: "noSite" }).tooltip).toContain("interval.url");
});

test("each problem is explained in the tooltip", () => {
  expect(show({ kind: "refused" })).toEqual({
    text: "$(warning) Interval: sign in",
    tooltip: expect.stringContaining("refused the device token") as unknown,
  });
  expect(show({ kind: "plan" }).tooltip).toBe(
    "Your Interval plan doesn't include the agent hook.",
  );
  expect(
    show({ kind: "rateLimited", retryAfterSeconds: 60 }).tooltip,
  ).toContain("60s");
  expect(show({ kind: "redirect" }).tooltip).toBe(
    "interval.url redirects: set it to the site's final address.",
  );
  expect(
    show({ kind: "failed", detail: "couldn't reach Interval (fetch failed)" })
      .tooltip,
  ).toBe("Couldn't check your agent: couldn't reach Interval (fetch failed).");
  expect(
    show({ kind: "badSite", reason: "interval.url is refused: why." }),
  ).toEqual({
    text: "$(warning) Interval",
    tooltip: "interval.url is refused: why.",
  });
});
