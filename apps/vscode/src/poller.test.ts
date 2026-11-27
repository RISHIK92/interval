import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { StatusResult } from "./api";
import { type Check, POLL_MS, Poller } from "./poller";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const OK: StatusResult = {
  kind: "ok",
  status: { task: { state: "idle" }, chip: "3-8", suggestions: [] },
};

// A check that answers each call with the next of `results` (the last one repeats).
function checking(...results: (StatusResult | null)[]) {
  let call = 0;
  const run = vi.fn(() => {
    const result = results[Math.min(call, results.length - 1)] ?? null;
    call += 1;
    return Promise.resolve(result);
  });
  const show = vi.fn<(checked: StatusResult | null) => void>();
  const log = vi.fn<(message: string) => void>();
  const check: Check<StatusResult | null> = {
    run,
    resultOf: (checked) => checked,
    show,
    log,
  };
  return { check, run, show, log };
}

test("it checks at once, then every 15 s while focused", async () => {
  const { check, run } = checking(OK);
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(POLL_MS - 1);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(POLL_MS * 4);
  expect(run).toHaveBeenCalledTimes(6);
  poller.dispose();
});

test("a failed check is retried every 15 s too", async () => {
  const { check, run } = checking({ kind: "failed", detail: "x" });
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(POLL_MS * 2);
  expect(run).toHaveBeenCalledTimes(3);
  poller.dispose();
});

test("in the background only the first check runs, until the window is focused", async () => {
  const { check, run } = checking(OK);
  const poller = new Poller(check, false);
  poller.start();
  await vi.advanceTimersByTimeAsync(POLL_MS * 10);
  expect(run).toHaveBeenCalledTimes(1);
  poller.setFocused(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(2);
  poller.setFocused(false);
  await vi.advanceTimersByTimeAsync(POLL_MS * 10);
  expect(run).toHaveBeenCalledTimes(2);
  poller.dispose();
});

test("refocusing soon after a check waits out the 15 s", async () => {
  const { check, run } = checking(OK);
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  poller.setFocused(false);
  await vi.advanceTimersByTimeAsync(5_000);
  poller.setFocused(true);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  poller.dispose();
});

test("a 429's Retry-After holds across a refocus", async () => {
  const { check, run } = checking(
    { kind: "rateLimited", retryAfterSeconds: 60 },
    OK,
  );
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  poller.setFocused(false);
  poller.setFocused(true);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  poller.dispose();
});

test("a short Retry-After still waits the 15 s", async () => {
  const { check, run } = checking(
    { kind: "rateLimited", retryAfterSeconds: 1 },
    OK,
  );
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(POLL_MS - 1);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  poller.dispose();
});

test("restart during a 429 wait waits it out", async () => {
  const { check, run } = checking(
    { kind: "rateLimited", retryAfterSeconds: 60 },
    OK,
  );
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(10_000);
  poller.restart({ newToken: false });
  await vi.advanceTimersByTimeAsync(49_999);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  poller.dispose();
});

test("a new token ends a 429 wait", async () => {
  const { check, run } = checking(
    { kind: "rateLimited", retryAfterSeconds: 60 },
    OK,
  );
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(10_000);
  poller.restart({ newToken: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(2);
  poller.dispose();
});

test("after a refusal it waits for a refocus or a restart", async () => {
  for (const kind of ["refused", "plan", "redirect"] as const) {
    const { check, run } = checking({ kind });
    const poller = new Poller(check, true);
    poller.start();
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(run, kind).toHaveBeenCalledTimes(1);
    poller.restart({ newToken: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(run, kind).toHaveBeenCalledTimes(2);
    poller.setFocused(false);
    poller.setFocused(true);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(run, kind).toHaveBeenCalledTimes(3);
    poller.dispose();
  }
});

test("without a request (signed out, no site) it waits for a restart", async () => {
  const { check, run } = checking(null);
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(POLL_MS * 10);
  expect(run).toHaveBeenCalledTimes(1);
  poller.dispose();
});

// A check held open until the test lets it answer.
function gated() {
  const pending: ((result: StatusResult) => void)[] = [];
  let inFlight = 0;
  let most = 0;
  const run = vi.fn(
    () =>
      new Promise<StatusResult>((resolve) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        pending.push((result) => {
          inFlight -= 1;
          resolve(result);
        });
      }),
  );
  const show = vi.fn<(checked: StatusResult) => void>();
  const check: Check<StatusResult> = {
    run,
    resultOf: (checked) => checked,
    show,
    log: () => undefined,
  };
  return {
    check,
    run,
    show,
    answer: (result: StatusResult) => pending.shift()?.(result),
    most: () => most,
  };
}

test("a restart during a check drops its answer and checks again, never two at once", async () => {
  const { check, run, show, answer, most } = gated();
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  poller.restart({ newToken: true });
  poller.setFocused(true);
  await vi.advanceTimersByTimeAsync(POLL_MS * 2);
  expect(run).toHaveBeenCalledTimes(1);
  answer(OK);
  await vi.advanceTimersByTimeAsync(0);
  expect(show).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledTimes(2);
  answer(OK);
  await vi.advanceTimersByTimeAsync(0);
  expect(show).toHaveBeenCalledTimes(1);
  expect(most()).toBe(1);
  poller.dispose();
});

test("a 429 that comes back after a settings change still holds", async () => {
  const { check, run, answer } = gated();
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  poller.restart({ newToken: false });
  answer({ kind: "rateLimited", retryAfterSeconds: 60 });
  await vi.advanceTimersByTimeAsync(59_999);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  poller.dispose();
});

test("a click joins the check in flight, is held during a 429 wait, and its own 429 holds", async () => {
  const { check, run, answer } = gated();
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  const joined = poller.now();
  answer(OK);
  expect(await joined).toEqual(OK);
  expect(run).toHaveBeenCalledTimes(1);

  const clicked = poller.now();
  expect(run).toHaveBeenCalledTimes(2);
  answer({ kind: "rateLimited", retryAfterSeconds: 60 });
  expect(await clicked).toEqual({ kind: "rateLimited", retryAfterSeconds: 60 });
  expect(await poller.now()).toBe("held");
  await vi.advanceTimersByTimeAsync(59_999);
  expect(run).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(3);
  poller.dispose();
});

test("a check that throws is logged and retried in 15 s", async () => {
  const log = vi.fn<(message: string) => void>();
  const run = vi
    .fn<() => Promise<StatusResult>>()
    .mockRejectedValueOnce(new Error("keyring locked"))
    .mockResolvedValue(OK);
  const poller = new Poller(
    { run, resultOf: (checked) => checked, show: () => undefined, log },
    true,
  );
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("keyring locked"));
  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(run).toHaveBeenCalledTimes(2);
  poller.dispose();
});

test("nothing is checked after dispose", async () => {
  const { check, run } = checking(OK);
  const poller = new Poller(check, true);
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  poller.dispose();
  poller.setFocused(true);
  poller.restart({ newToken: false });
  expect(await poller.now()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(POLL_MS * 10);
  expect(run).toHaveBeenCalledTimes(1);
});
