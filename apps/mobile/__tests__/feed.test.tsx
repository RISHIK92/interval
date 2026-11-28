import { act, fireEvent, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { ActionSheetIOS } from "react-native";

// P4-W20-S01 (§5A): Home's feed in the app: the same cards as the PWA, with the card's
// explanation, the project note labeled as AI, save and the card menu. ADR-0058: each
// card is a whole article, with no time chip.
const card = (
  itemId: string,
  title: string,
  state: "unread" | "continue_reading" | "completed" = "unread",
) => ({
  itemId,
  articleTitle: title,
  author: null,
  sourceName: "A blog",
  estimatedMinutes: 6,
  state,
  reasons: { text: "On your path", kinds: ["goal_match"] },
  projectNote:
    itemId === "5"
      ? {
          text: "Your orders API elects a leader too.",
          repositories: ["me/api"],
        }
      : null,
  saved: false,
  frameable: true,
  topic: "distributed-systems",
  difficulty: "intermediate",
});
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
// The feed's own calls: the mini-player's read of the audio queue (P4-W23-S02) left out.
const calls = () =>
  fetchMock.mock.calls
    .map(([url, init]) => ({
      url: url.replace("http://localhost:3100", ""),
      method: init.method,
      body:
        typeof init.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : null,
    }))
    .filter((c) => c.url !== "/api/listen");

const first = <T,>(found: T[]): T => {
  const [one] = found;
  if (one === undefined) throw new Error("none found");
  return one;
};

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation((url) =>
    Promise.resolve(
      !url.endsWith("/api/feed/control")
        ? Response.json({
            cards: [card("5", "Raft", "continue_reading"), card("6", "Paxos")],
          })
        : new Response(null, { status: 204 }),
    ),
  );
});
afterEach(() => {
  jest.clearAllMocks();
});

test("the feed shows each card with its explanation and the AI-labeled project note", async () => {
  await renderRouter("./app", { initialUrl: "/" });
  expect(await screen.findByText("Raft")).toBeOnTheScreen();
  expect(screen.getByText("Paxos")).toBeOnTheScreen();
  // As the PWA: the project note takes the reason line's place (ADR-0027).
  expect(screen.getAllByText("On your path")).toHaveLength(1);
  expect(screen.getByText(/For your project me\/api:/)).toBeOnTheScreen();
  expect(
    screen.getByText(/Your orders API elects a leader too\./),
  ).toBeOnTheScreen();
  // AI-3: the model's line is labeled.
  expect(screen.getAllByText("AI")).toHaveLength(1);
  expect(screen.getAllByText("6 min read")).toHaveLength(2);
  expect(calls()[0]).toMatchObject({ url: "/api/feed", method: "GET" });
});

// ADR-0058: an article opened and not completed says so; an unread one says nothing.
test("an article read part way says Continue reading, and a completed one Completed", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      Response.json({
        cards: [
          card("5", "Raft", "continue_reading"),
          card("6", "Paxos"),
          card("7", "Gossip", "completed"),
        ],
      }),
    ),
  );
  await renderRouter("./app", { initialUrl: "/" });
  await screen.findByText("Raft");
  expect(screen.getAllByText("Continue reading")).toHaveLength(1);
  expect(screen.getAllByText("Completed")).toHaveLength(1);
});

test("an article of unknown length says so", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      Response.json({
        cards: [{ ...card("5", "Raft"), estimatedMinutes: null }],
      }),
    ),
  );
  await renderRouter("./app", { initialUrl: "/" });
  expect(await screen.findByText("Length unknown")).toBeOnTheScreen();
});

test("no time chips", async () => {
  await renderRouter("./app", { initialUrl: "/" });
  await screen.findByText("Raft");
  expect(screen.queryByRole("button", { name: /min$/ })).toBeNull();
});

test("Save saves through the card controls and says Saved", async () => {
  await renderRouter("./app", { initialUrl: "/" });
  await screen.findByText("Raft");
  await fireEvent.press(first(screen.getAllByRole("button", { name: "Save" })));
  expect(
    await screen.findByRole("button", { name: "Saved" }),
  ).toBeOnTheScreen();
  expect(calls()).toContainEqual({
    url: "/api/feed/control",
    method: "POST",
    body: { itemId: "5", control: "save" },
  });
});

test("Hide source reads the feed again, so the source's other cards go too", async () => {
  const sheet = jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementation((options, pick) => {
      pick(options.options.indexOf("Hide source"));
    });
  await renderRouter("./app", { initialUrl: "/" });
  await screen.findByText("Raft");
  fetchMock.mockImplementation((url) =>
    Promise.resolve(
      url.endsWith("/api/feed/control")
        ? new Response(null, { status: 204 })
        : Response.json({ cards: [] }),
    ),
  );
  await fireEvent.press(
    first(screen.getAllByRole("button", { name: "More options" })),
  );
  expect(await screen.findByText(/Nothing to read yet/)).toBeOnTheScreen();
  expect(calls().map((c) => c.url)).toEqual([
    "/api/feed",
    "/api/feed/control",
    "/api/feed",
  ]);
  sheet.mockRestore();
});

test("a save that can't be sent is undone", async () => {
  fetchMock.mockImplementation((url) =>
    url.endsWith("/api/feed/control")
      ? Promise.reject(new TypeError("Network request failed"))
      : Promise.resolve(Response.json({ cards: [card("6", "Paxos")] })),
  );
  await renderRouter("./app", { initialUrl: "/" });
  await screen.findByText("Paxos");
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("button", { name: "Save" })).toBeOnTheScreen();
  expect(calls().map((c) => c.url)).toContain("/api/feed/control");
});

test("Not interested from the card menu takes the card away", async () => {
  const sheet = jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementation((options, pick) => {
      pick(options.options.indexOf("Not interested"));
    });
  await renderRouter("./app", { initialUrl: "/" });
  await screen.findByText("Raft");
  // Stored, the item leaves the feed's read too.
  fetchMock.mockImplementation((url) =>
    Promise.resolve(
      url.endsWith("/api/feed/control")
        ? new Response(null, { status: 204 })
        : Response.json({ cards: [card("6", "Paxos")] }),
    ),
  );
  await fireEvent.press(
    first(screen.getAllByRole("button", { name: "More options" })),
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByText("Raft")).toBeNull();
  expect(calls()).toContainEqual({
    url: "/api/feed/control",
    method: "POST",
    body: { itemId: "5", control: "not_interested" },
  });
  sheet.mockRestore();
});

test("an account not yet set up is sent to the web to finish", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 409 })),
  );
  await renderRouter("./app", { initialUrl: "/" });
  expect(
    await screen.findByText(/Finish setting up on the web/),
  ).toBeOnTheScreen();
});

test("an account without a username is told to pick one", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json({ setup: "username" }, { status: 409 })),
  );
  await renderRouter("./app", { initialUrl: "/" });
  expect(await screen.findByText(/Pick a username/)).toBeOnTheScreen();
});

test("a plan without the feed says so", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 403 })),
  );
  await renderRouter("./app", { initialUrl: "/" });
  expect(
    await screen.findByText("Your plan doesn't include the feed."),
  ).toBeOnTheScreen();
});

test("pull to refresh reads the feed again, from a failure too", async () => {
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(new Response(null, { status: 503 })),
  );
  await renderRouter("./app", { initialUrl: "/" });
  await screen.findByText(/Couldn't load your feed/);
  // The list's RefreshControl, as a pull would fire it.
  const { refreshControl } = screen.getByTestId("feed").props as {
    refreshControl: { props: { onRefresh: () => void } };
  };
  await act(async () => {
    refreshControl.props.onRefresh();
    await Promise.resolve();
  });
  expect(await screen.findByText("Raft")).toBeOnTheScreen();
  expect(calls().filter((c) => c.method === "GET")).toHaveLength(2);
});

test("a slow earlier read doesn't replace a later one", async () => {
  let answerFirst: (r: Response) => void = () => undefined;
  let feedReads = 0;
  // By URL: the mini-player reads the audio queue beside the feed (P4-W23-S02).
  fetchMock.mockImplementation((url) => {
    if (!url.includes("/api/feed"))
      return Promise.resolve(new Response(null, { status: 503 }));
    feedReads += 1;
    return feedReads === 1
      ? new Promise((resolve) => {
          answerFirst = resolve;
        })
      : Promise.resolve(Response.json({ cards: [card("7", "Gossip")] }));
  });
  await renderRouter("./app", { initialUrl: "/" });
  const { refreshControl } = screen.getByTestId("feed").props as {
    refreshControl: { props: { onRefresh: () => void } };
  };
  await act(async () => {
    refreshControl.props.onRefresh();
    await Promise.resolve();
  });
  await screen.findByText("Gossip");
  await act(async () => {
    answerFirst(Response.json({ cards: [card("5", "Raft")] }));
    await Promise.resolve();
  });
  expect(screen.getByText("Gossip")).toBeOnTheScreen();
  expect(screen.queryByText("Raft")).toBeNull();
});

test("a control the server refuses is undone", async () => {
  fetchMock.mockImplementation((url) =>
    Promise.resolve(
      url.endsWith("/api/feed/control")
        ? new Response(null, { status: 500 })
        : Response.json({ cards: [card("5", "Raft")] }),
    ),
  );
  const sheet = jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementation((options, pick) => {
      pick(options.options.indexOf("Hide source"));
    });
  await renderRouter("./app", { initialUrl: "/" });
  await screen.findByText("Raft");
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("button", { name: "Save" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "More options" }));
  expect(await screen.findByText("Raft")).toBeOnTheScreen();
  sheet.mockRestore();
});

test("a card opens the reader with its position", async () => {
  await renderRouter("./app", { initialUrl: "/" });
  await fireEvent.press(await screen.findByText("Paxos"));
  expect(screen).toHavePathname("/read/6");
  await act(async () => {
    await Promise.resolve();
  });
  expect(calls().map((c) => c.url)).toContain("/api/read/6?pos=2");
});
