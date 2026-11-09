import { act, fireEvent, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { renderRouter } from "expo-router/testing-library";
import { AppState, type AppStateStatus } from "react-native";
import { openMatch } from "../lib/live";

// P4-W21-S02 (Q-P4-05, ADR-0033): live 1v1 in the app on the web's protocol client: the
// queue, the ticket's socket on the site, a sprint and a fastest-finger round.
class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 1;
  sent: unknown[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
}
const socket = () => {
  if (FakeSocket.last === null) throw new Error("no socket");
  return FakeSocket.last;
};
const push = async (message: object) => {
  await act(async () => {
    socket().onmessage?.({ data: JSON.stringify(message) });
    await Promise.resolve();
  });
};

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const ticketUrl = { url: "/game/0/ws?ticket=t1" };
const serve = (ticket: object = ticketUrl) => {
  fetchMock.mockImplementation((url, init) => {
    const path = url.replace("http://localhost:3100", "");
    if (path.startsWith("/api/game/queue"))
      return Promise.resolve(
        init.method === "PUT"
          ? Response.json({ status: "matched", matchId: "m1" })
          : new Response(null, { status: 204 }),
      );
    if (path === "/api/game/ticket")
      return Promise.resolve(Response.json(ticket));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
};
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: url.replace("http://localhost:3100", ""),
    method: init.method,
  }));

const realSocket = globalThis.WebSocket;
beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  FakeSocket.last = null;
  serve();
});
afterEach(() => {
  globalThis.WebSocket = realSocket;
  jest.clearAllMocks();
});

test("a sprint: queued, matched, the site's socket, a question answered and felt, the final", async () => {
  await renderRouter("./app", { initialUrl: "/live/sprint" });
  expect(
    await screen.findByText("Opponent found. Connecting…"),
  ).toBeOnTheScreen();
  expect(calls().slice(0, 3)).toEqual([
    { url: "/api/game/queue?mode=sprint", method: "POST" },
    { url: "/api/game/queue?mode=sprint", method: "PUT" },
    { url: "/api/game/ticket", method: "POST" },
  ]);
  expect(socket().url).toBe("ws://localhost:3100/game/0/ws?ticket=t1");
  await push({ type: "joined", you: "u1" });
  await push({ type: "start", seconds: 60 });
  await push({
    type: "question",
    n: 1,
    stem: "What elects a leader?",
    options: ["Raft", "TCP"],
    ai: true,
  });
  expect(screen.getByText("AI-drafted")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Raft" }));
  expect(socket().sent).toContainEqual({ type: "answer", n: 1, choice: 0 });
  expect(screen.getByRole("button", { name: "Raft" })).toBeDisabled();
  await push({ type: "judged", n: 1, correct: true });
  expect(screen.getByText("✓ Right")).toBeOnTheScreen();
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  await push({ type: "final", totals: { u1: 1, u2: 0 }, winner: "u1" });
  expect(screen.getByText("You won")).toBeOnTheScreen();
  expect(screen.getByText("Correct: you 1 · opponent 0")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Play again" })).toBeOnTheScreen();
});

test("fastest finger: a round locked in, its reveal, the final", async () => {
  await renderRouter("./app", { initialUrl: "/live/fastest_finger" });
  await screen.findByText("Opponent found. Connecting…");
  await push({ type: "joined", you: "u1", opponent: "a bot" });
  // BOT-3: not a person, and it says so.
  expect(screen.getByText("Playing a bot")).toBeOnTheScreen();
  await push({
    type: "round",
    n: 1,
    stem: "Which is a consensus protocol?",
    options: ["Paxos", "HTTP"],
    seconds: 10,
  });
  await fireEvent.press(screen.getByRole("button", { name: "Paxos" }));
  expect(
    screen.getByText("🔒 You: locked in · ⏳ Opponent: thinking"),
  ).toBeOnTheScreen();
  await push({
    type: "reveal",
    n: 1,
    stem: "Which is a consensus protocol?",
    options: ["Paxos", "HTTP"],
    correct: 0,
    taken: "u1",
    totals: { u1: 1 },
  });
  expect(screen.getByText("✓ You took this round")).toBeOnTheScreen();
  await push({ type: "final", totals: { u1: 1 }, winner: "u1" });
  expect(
    screen.getByText("Rounds taken: you 1 · opponent 0"),
  ).toBeOnTheScreen();
});

test.each(["background", "inactive"] as const)(
  "%s mid-match counts as a focus switch (§6.9), as a hidden tab or blur does",
  async (next) => {
    let change: (state: AppStateStatus) => void = () => undefined;
    const listen = jest
      .spyOn(AppState, "addEventListener")
      // This screen's listener only; later ones reach React Native's own.
      .mockImplementationOnce((_, handler) => {
        change = handler;
        return { remove: () => undefined };
      });
    await renderRouter("./app", { initialUrl: "/live/sprint" });
    await screen.findByText("Opponent found. Connecting…");
    await act(async () => {
      change(next);
      await Promise.resolve();
    });
    expect(socket().sent).toContainEqual({ type: "focus" });
    expect(listen).toHaveBeenCalled();
  },
);

test("leaving while queued leaves the queue", async () => {
  fetchMock.mockImplementation((_, init) =>
    Promise.resolve(
      init.method === "PUT"
        ? Response.json({ status: "waiting" })
        : new Response(null, { status: 204 }),
    ),
  );
  const { unmount } = await renderRouter("./app", {
    initialUrl: "/live/fastest_finger",
  });
  await screen.findByText("Finding an opponent…");
  await unmount();
  expect(calls()).toContainEqual({
    url: "/api/game/queue?mode=fastest_finger",
    method: "DELETE",
  });
});

test("Play bot now: a bot's match, and the socket for it", async () => {
  fetchMock.mockImplementation((url, init) => {
    const path = url.replace("http://localhost:3100", "");
    if (path.startsWith("/api/game/bot"))
      return Promise.resolve(Response.json({ matchId: "b1" }));
    if (path === "/api/game/ticket")
      return Promise.resolve(Response.json(ticketUrl));
    return Promise.resolve(
      init.method === "PUT"
        ? Response.json({ status: "waiting" })
        : new Response(null, { status: 204 }),
    );
  });
  await renderRouter("./app", { initialUrl: "/live/sprint" });
  await fireEvent.press(
    await screen.findByRole("button", { name: "Play bot now" }),
  );
  expect(
    await screen.findByText(
      "Opponent found. Connecting…",
      {},
      { timeout: 4000 },
    ),
  ).toBeOnTheScreen();
  expect(calls()).toContainEqual({
    url: "/api/game/bot?mode=sprint",
    method: "POST",
  });
  expect(socket().url).toBe("ws://localhost:3100/game/0/ws?ticket=t1");
});

test("Play again queues afresh", async () => {
  await renderRouter("./app", { initialUrl: "/live/sprint" });
  await screen.findByText("Opponent found. Connecting…");
  await push({ type: "joined", you: "u1" });
  await push({ type: "final", totals: { u1: 0, u2: 1 }, winner: "u2" });
  expect(screen.getByText("You lost")).toBeOnTheScreen();
  const queued = () =>
    calls().filter((c) => c.method === "POST" && c.url.includes("queue"));
  const before = queued().length;
  await fireEvent.press(screen.getByRole("button", { name: "Play again" }));
  await screen.findByText("Opponent found. Connecting…");
  expect(queued()).toHaveLength(before + 1);
});

test("a ticket whose socket isn't on the site is refused", async () => {
  const on = { message: () => undefined, close: () => undefined };
  serve({ url: "https://elsewhere.dev/game/0/ws?ticket=t" });
  await expect(openMatch("m1", on)).rejects.toThrow(
    "not this site's game server",
  );
  serve({ url: "//elsewhere.dev/game/0/ws" });
  await expect(openMatch("m1", on)).rejects.toThrow();
  // Only the game server's path, once resolved.
  serve({ url: "/game/../api/feed" });
  await expect(openMatch("m1", on)).rejects.toThrow();
  expect(FakeSocket.last).toBeNull();
});
