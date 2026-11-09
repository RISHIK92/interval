import { act, fireEvent, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Linking } from "react-native";

// P4-W20-S02 (ADR-0018, §3.2): the publisher's live page in a WebView, Interval's row
// below it: Save, Note, Mark done, Next section; Highlight, Listen and Test me later.
const page = {
  url: "https://blog.dev/raft?utm_source=interval#election",
  inApp: true,
  title: "Leader election — Raft",
  domain: "blog.dev",
  saved: false,
  reached: "9",
  nextMomentId: "10",
  note: null,
};
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: url.replace("http://localhost:3100", ""),
    method: init.method,
    body:
      typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null,
  }));
const answer = (reader: object) => {
  fetchMock.mockImplementation((url) =>
    Promise.resolve(
      url.includes("/api/read/5")
        ? Response.json(reader)
        : new Response(null, { status: 204 }),
    ),
  );
};
const OPEN = "/read/5?moment=9&chip=3-8&pos=2";
const webView = () =>
  screen.getByTestId("publisher-page").props as {
    source: { uri: string };
    onLoadEnd: () => void;
    onError: () => void;
  };

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  answer(page);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

test("a feed card's open shows the publisher's page and its site", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  expect(await screen.findByText("blog.dev")).toBeOnTheScreen();
  expect(webView().source.uri).toBe(page.url);
  expect(calls()[0]).toMatchObject({
    url: "/api/read/5?moment=9&chip=3-8&pos=2",
    method: "GET",
  });
});

test("Save saves through the card controls", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  await fireEvent.press(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByRole("button", { name: "Saved" }),
  ).toBeOnTheScreen();
  expect(calls()).toContainEqual({
    url: "/api/feed/control",
    method: "POST",
    body: { itemId: "5", control: "save" },
  });
});

test("Highlight, Listen and Test me are shown, not usable yet", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  for (const name of ["Highlight", "Listen", "Test me"]) {
    expect(
      screen.getByRole("button", { name: `${name}. Coming later` }),
    ).toBeDisabled();
  }
});

test("Mark done finishes what's shown and leaves", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  await fireEvent.press(screen.getByRole("button", { name: "Mark done" }));
  expect(calls()).toContainEqual({
    url: "/api/read/finish",
    method: "POST",
    body: { itemId: "5", momentId: "9" },
  });
  expect(screen).toHavePathname("/");
});

test("Next section opens the next moment, from the same card", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  answer({ ...page, reached: "10", nextMomentId: null });
  await fireEvent.press(screen.getByRole("button", { name: "Next section" }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(calls().map((c) => c.url)).toContain(
    "/api/read/5?moment=10&chip=3-8&pos=2",
  );
  expect(screen.queryByRole("button", { name: "Next section" })).toBeNull();
});

test("a note is written on what's shown", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  await fireEvent.press(screen.getByRole("button", { name: "Note" }));
  await fireEvent.changeText(
    screen.getByLabelText("Your note"),
    "Leases bound the term.",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Save note" }));
  expect(calls()).toContainEqual({
    url: "/api/notes",
    method: "PUT",
    body: { itemId: "5", momentId: "9", body: "Leases bound the term." },
  });
  expect(await screen.findByText("Note saved")).toBeOnTheScreen();
});

test("a page that fails to load offers the browser below it", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  expect(screen.queryByText("Open on blog.dev")).toBeNull();
  await act(async () => {
    webView().onError();
    await Promise.resolve();
  });
  expect(screen.getByText("Didn't load?")).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", { name: "Open on blog.dev" }),
  );
  expect(open).toHaveBeenCalledWith(page.url);
  // As the web's /out?from=reader: the click, the open already counted.
  expect(calls()).toContainEqual({
    url: "/api/read/5/out",
    method: "POST",
    body: { moment: "9" },
  });
  open.mockRestore();
});

test("a page that's late gets a notice below it, which its load clears", async () => {
  jest.useFakeTimers();
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  await act(async () => {
    jest.advanceTimersByTime(6000);
    await Promise.resolve();
  });
  expect(screen.getByText("Slow to load?")).toBeOnTheScreen();
  // Below the page, never instead of it.
  expect(screen.getByTestId("publisher-page")).toBeOnTheScreen();
  await act(async () => {
    webView().onLoadEnd();
    await Promise.resolve();
  });
  expect(screen.queryByText("Slow to load?")).toBeNull();
});

test("loaded in time, no notice; a notice can be dismissed", async () => {
  jest.useFakeTimers();
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  await act(async () => {
    webView().onLoadEnd();
    jest.advanceTimersByTime(6000);
    await Promise.resolve();
  });
  expect(screen.queryByText("Slow to load?")).toBeNull();
  await act(async () => {
    webView().onError();
    await Promise.resolve();
  });
  await fireEvent.press(
    screen.getByRole("button", { name: "Dismiss slow-load notice" }),
  );
  expect(screen.queryByText("Didn't load?")).toBeNull();
});

test("a Mark done that fails says so and stays", async () => {
  fetchMock.mockImplementation((url) =>
    Promise.resolve(
      url.includes("/api/read/5?")
        ? Response.json(page)
        : new Response(null, { status: 500 }),
    ),
  );
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  await fireEvent.press(screen.getByRole("button", { name: "Mark done" }));
  expect(await screen.findByText(/Couldn't mark this done/)).toBeOnTheScreen();
  expect(screen).toHavePathname("/read/5");
});

test("a page not served over https goes to the browser, not the WebView", async () => {
  answer({ ...page, url: "http://blog.dev/raft", inApp: false });
  await renderRouter("./app", { initialUrl: OPEN });
  expect(
    await screen.findByRole("button", { name: "Open on blog.dev" }),
  ).toBeOnTheScreen();
  expect(screen.queryByTestId("publisher-page")).toBeNull();
});
