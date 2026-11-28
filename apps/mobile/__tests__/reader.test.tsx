import { act, fireEvent, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Linking } from "react-native";

// P4-W20-S02 (ADR-0018, §3.2): the publisher's live page in a WebView, Interval's row
// below it: Save, Note, Done; Highlight later, Listen and Quiz me once there is
// something. ADR-0058: always the whole article.
const page = {
  url: "https://blog.dev/raft?utm_source=interval",
  inApp: true,
  title: "Raft",
  domain: "blog.dev",
  saved: false,
  state: "continue_reading",
  note: null,
  testable: false,
  listen: false,
  measure: null,
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
const OPEN = "/read/5?pos=2";
const webView = () =>
  screen.getByTestId("publisher-page").props as {
    source: { uri: string };
    onLoadEnd: () => void;
    onError: () => void;
    injectedJavaScript?: string;
    onMessage?: (event: { nativeEvent: { data: string } }) => void;
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
    url: "/api/read/5?pos=2",
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

test("Highlight, Listen and Quiz me are shown, not usable yet", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  expect(
    screen.getByRole("button", { name: "Highlight. Coming later" }),
  ).toBeDisabled();
  // P4-W23-S02: Listen waits for a voiced explainer.
  expect(
    screen.getByRole("button", { name: "Listen. No AI explainer here yet" }),
  ).toBeDisabled();
  // P4-W21-S01, ADR-0058: Quiz me waits for the article's questions.
  expect(
    screen.getByRole("button", { name: "Quiz me. No questions yet" }),
  ).toBeDisabled();
});

test("Done completes the article and leaves", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(calls()).toContainEqual({
    url: "/api/read/finish",
    method: "POST",
    body: { itemId: "5", method: "mark_done" },
  });
  expect(screen).toHavePathname("/");
});

// ADR-0058: Completed replaces Done.
test("a completed article says Completed in Done's place", async () => {
  answer({ ...page, state: "completed" });
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  expect(screen.getByText("Completed")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
});

test("no Next section: the article is the one reading", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  expect(screen.queryByRole("button", { name: "Next section" })).toBeNull();
});

test("a note is written on the article", async () => {
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
    body: { itemId: "5", body: "Leases bound the term." },
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
    body: {},
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

test("a Done that fails says so and stays", async () => {
  fetchMock.mockImplementation((url) =>
    Promise.resolve(
      url.includes("/api/read/5?")
        ? Response.json(page)
        : new Response(null, { status: 500 }),
    ),
  );
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
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

// P4-W20-S03 (§5D, owner 2026-11-09): read through is 90% of the page after half its
// minutes (30 s at least); the reader then completes the article once, quietly, and
// stays (ADR-0058).
const measured = { ...page, measure: { minutes: 2 } };
const report = async (data: unknown) => {
  await act(async () => {
    webView().onMessage?.({ nativeEvent: { data: JSON.stringify(data) } });
    await Promise.resolve();
  });
};
const finishes = () => calls().filter((c) => c.url === "/api/read/finish");

test("an article of unknown length: no script", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  expect(webView().injectedJavaScript).toBeUndefined();
});

test("read through before the time floor finishes when it passes, once", async () => {
  jest.useFakeTimers();
  answer(measured);
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  expect(webView().injectedJavaScript).toContain(JSON.stringify(page.url));
  await report({ type: "progress", value: 0.95 });
  expect(finishes()).toEqual([]);
  // Half of 2 minutes is 60 s.
  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
  });
  expect(await screen.findByText("Completed")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  await report({ type: "progress", value: 1 });
  expect(finishes()).toEqual([
    {
      url: "/api/read/finish",
      method: "POST",
      body: { itemId: "5", method: "auto" },
    },
  ]);
  expect(screen).toHavePathname("/read/5");
});

test("short of 90% or a stray message: never finished", async () => {
  jest.useFakeTimers();
  answer({ ...measured, measure: { ...measured.measure, minutes: 1 } });
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  await act(async () => {
    // A one-minute article still waits 30 s.
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
  });
  await report({ type: "progress", value: 0.85 });
  await report({ type: "progress", value: 7 });
  await report("not the script");
  await report({ type: "unmeasurable" });
  expect(finishes()).toEqual([]);
  expect(warn).toHaveBeenCalledWith(
    "reader: a message not from the measuring script",
  );
  warn.mockRestore();
});

test("an automatic finish that fails is tried again", async () => {
  jest.useFakeTimers();
  let failures = 1;
  fetchMock.mockImplementation((url) => {
    if (url.includes("/api/read/5?"))
      return Promise.resolve(Response.json(measured));
    if (url.endsWith("/api/read/finish") && failures > 0) {
      failures -= 1;
      return Promise.resolve(new Response(null, { status: 503 }));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
  });
  await report({ type: "progress", value: 1 });
  expect(finishes()).toHaveLength(1);
  expect(screen.queryByText("Completed")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(15_000);
    await Promise.resolve();
  });
  expect(await screen.findByText("Completed")).toBeOnTheScreen();
  expect(finishes()).toHaveLength(2);
  warn.mockRestore();
});

test("a completed article isn't measured again", async () => {
  answer({ ...measured, state: "completed" });
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  expect(webView().injectedJavaScript).toBeUndefined();
});
