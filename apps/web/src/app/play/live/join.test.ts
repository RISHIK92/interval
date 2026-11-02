import { afterEach, expect, test, vi } from "vitest";
import { openMatch } from "./join";

// P3-W15-S02 (ADR-0033): the browser asks for a ticket, then opens the socket with it.
class FakeSocket {
  static opened: string[] = [];
  constructor(readonly url: string) {
    FakeSocket.opened.push(url);
  }
}

afterEach(() => {
  FakeSocket.opened = [];
  vi.unstubAllGlobals();
});

function stub(origin: string, response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("location", new URL(origin));
  vi.stubGlobal("WebSocket", FakeSocket);
  return fetch;
}

test("asks for a ticket for the match, then opens wss on the same host", async () => {
  const fetch = stub(
    "https://interval.example/play",
    Response.json({ url: "/game/0/ws?ticket=v1.a.b" }),
  );
  const socket = await openMatch("6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b");
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/game/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId: "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b" }),
  });
  expect((socket as unknown as FakeSocket).url).toBe(
    "wss://interval.example/game/0/ws?ticket=v1.a.b",
  );
});

test("plain ws on a plain-http local site", async () => {
  stub(
    "http://localhost:3100/play",
    Response.json({ url: "/game/0/ws?ticket=t" }),
  );
  await openMatch("m");
  expect(FakeSocket.opened).toEqual(["ws://localhost:3100/game/0/ws?ticket=t"]);
});

test("no ticket (not a player, signed out, live games off): no socket, says why", async () => {
  stub("https://interval.example/", new Response(null, { status: 404 }));
  await expect(openMatch("m")).rejects.toThrow("no ticket: 404");
  expect(FakeSocket.opened).toEqual([]);
});

test("a ticket URL for another site is never opened", async () => {
  stub(
    "https://interval.example/",
    Response.json({ url: "//evil.example/game/0/ws?ticket=t" }),
  );
  await expect(openMatch("m")).rejects.toThrow("not this site");
  expect(FakeSocket.opened).toEqual([]);
});

test("a ticket answer without a socket path opens nothing", async () => {
  stub("https://interval.example/", Response.json({ link: "/game/0/ws" }));
  await expect(openMatch("m")).rejects.toThrow("no socket in the ticket");
  expect(FakeSocket.opened).toEqual([]);
});
