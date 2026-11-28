// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { AskBox } from "./AskBox";

// ADR-0046: Ask sends the question with a fresh idempotency key, asks again until the
// worker answered, and a follow-up names the question it follows. Chips only prefill.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const ID = "11111111-1111-4111-8111-111111111111";

// getRandomValues filled with one byte: a known key (the box makes a v4 UUID from it).
const randomBytes = (byte: number) => ({
  getRandomValues: (a: Uint8Array) => a.fill(byte),
});
const KEY_1 = "01010101-0101-4101-8101-010101010101";

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<AskBox canAsk query="" initial={null} />);
  });
  return host;
}

// React tracks the value it set; the prototype's setter makes the change its own.
function type(input: HTMLInputElement, value: string) {
  Reflect.set(HTMLInputElement.prototype, "value", value, input);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const sent = (init: RequestInit | undefined): unknown =>
  typeof init?.body === "string" ? JSON.parse(init.body) : null;

const button = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name);

test("asking queues the question, then shows the answer once written", async () => {
  vi.useFakeTimers();
  const answered = {
    id: ID,
    text: "Explain like I’m new: sharding",
    chip: "explain_new",
    depth: 0,
    answer: {
      outcome: "answered",
      text: "Sharding splits data. [m9]",
      citations: [
        {
          kind: "reading",
          passage: "m9",
          itemId: "5",
          label: "DDIA · Partitioning",
          topic: "databases",
        },
      ],
    },
  };
  const fetch = vi
    .fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(Response.json({ id: ID }, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ ...answered, answer: null }))
    .mockResolvedValueOnce(Response.json(answered))
    .mockResolvedValueOnce(Response.json({ id: "x" }, { status: 202 }));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("crypto", randomBytes(1));
  const host = mount();
  const input = host.querySelector("input");
  if (input === null) throw new Error("no box");
  act(() => {
    button(host, "Explain like I’m new")?.click();
  });
  expect(input.value).toBe("Explain like I’m new: ");
  act(() => {
    type(input, "Explain like I’m new: sharding");
  });
  await act(async () => {
    button(host, "Ask")?.click();
    await Promise.resolve();
  });
  const [url, init] = fetch.mock.calls[0] ?? [];
  expect(url).toBe("/api/explore/ask");
  expect(sent(init)).toEqual({
    text: "Explain like I’m new: sharding",
    chip: "explain_new",
    idempotencyKey: KEY_1,
    followUpOf: null,
  });
  expect(host.textContent).toContain("Looking through your library…");
  // Still pending at the first poll; answered at the second.
  for (let i = 0; i < 2; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
  expect(fetch.mock.calls[1]?.[0]).toBe(`/api/explore/ask/${ID}`);
  expect(host.textContent).toContain("Sharding splits data.1");
  expect(host.querySelector('a[href*="from=explore"]')?.textContent).toContain(
    "DDIA · Partitioning",
  );
  act(() => {
    button(host, "Ask a follow-up")?.click();
  });
  act(() => {
    type(input, "And resharding?");
  });
  await act(async () => {
    button(host, "Ask follow-up")?.click();
    await Promise.resolve();
  });
  expect(sent(fetch.mock.calls[3]?.[1])).toMatchObject({
    text: "And resharding?",
    chip: null,
    followUpOf: ID,
  });
});

test("a refusal says why, and nothing waits", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({ refused: "daily_limit" }, { status: 429 }),
      ),
    ),
  );
  vi.stubGlobal("crypto", randomBytes(2));
  const host = mount();
  const input = host.querySelector("input");
  if (input === null) throw new Error("no box");
  act(() => {
    type(input, "When should I shard?");
  });
  await act(async () => {
    button(host, "Ask")?.click();
    await Promise.resolve();
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "You’ve asked all of today’s questions. Ask again tomorrow.",
  );
  expect(host.textContent).not.toContain("Looking through your library");
});

test("a failed request is said, and the retry reuses the question's key", async () => {
  const fetch = vi
    .fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json({ id: ID }, { status: 202 }));
  vi.stubGlobal("fetch", fetch);
  let n = 0;
  vi.stubGlobal("crypto", {
    getRandomValues: (a: Uint8Array) => a.fill(++n),
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const host = mount();
  const input = host.querySelector("input");
  if (input === null) throw new Error("no box");
  act(() => {
    type(input, "When should I shard?");
  });
  for (let i = 0; i < 2; i++)
    await act(async () => {
      button(host, "Ask")?.click();
      await Promise.resolve();
    });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  const keys = fetch.mock.calls.map(
    (c) => (sent(c[1]) as { idempotencyKey: string }).idempotencyKey,
  );
  expect(keys[0]).toBe(keys[1]);
});

// A page on plain http (the site over a LAN or Tailscale address in development) isn't a
// secure context, so browsers leave crypto.randomUUID out; the box must still mount and
// send a v4-shaped key.
test("Ask works where crypto.randomUUID is missing (plain http)", async () => {
  // Only getRandomValues, as on a plain-http page.
  vi.stubGlobal("crypto", randomBytes(7));
  const fetch = vi
    .fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(Response.json({ id: ID }, { status: 202 }));
  vi.stubGlobal("fetch", fetch);
  const host = mount();
  const input = host.querySelector("input");
  if (input === null) throw new Error("no box");
  act(() => {
    type(input, "What is a quorum?");
  });
  await act(async () => {
    button(host, "Ask")?.click();
    await Promise.resolve();
  });
  expect(sent(fetch.mock.calls[0]?.[1])).toMatchObject({
    idempotencyKey: "07070707-0707-4707-8707-070707070707",
  });
});
