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
const OPEN = "/read/5?moment=9&chip=3-8&pos=2";
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
  expect(
    screen.getByRole("button", { name: "Highlight. Coming later" }),
  ).toBeDisabled();
  // P4-W23-S02: Listen waits for a voiced explainer.
  expect(
    screen.getByRole("button", { name: "Listen. No AI explainer here yet" }),
  ).toBeDisabled();
  // P4-W21-S01: Test me waits for its section's questions.
  expect(
    screen.getByRole("button", { name: "Test me. No questions yet" }),
  ).toBeDisabled();
});

test("Mark done finishes what's shown and leaves", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  await fireEvent.press(screen.getByRole("button", { name: "Mark done" }));
  expect(calls()).toContainEqual({
    url: "/api/read/finish",
    method: "POST",
    body: { itemId: "5", momentId: "9", method: "mark_done" },
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

// P4-W20-S03 (§5D, owner 2026-11-09): read through is 90% of the section after half its
// minutes (30 s at least); the reader then finishes it once, quietly, and stays.
const measured = {
  ...page,
  measure: { start: { id: "election" }, end: { id: "log" }, minutes: 2 },
};
const report = async (data: unknown) => {
  await act(async () => {
    webView().onMessage?.({ nativeEvent: { data: JSON.stringify(data) } });
    await Promise.resolve();
  });
};
const finishes = () => calls().filter((c) => c.url === "/api/read/finish");

test("no section to measure: no script", async () => {
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  expect(webView().injectedJavaScript).toBeUndefined();
});

test("read through before the time floor finishes when it passes, once", async () => {
  jest.useFakeTimers();
  answer(measured);
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  expect(webView().injectedJavaScript).toContain('{"id":"election"}');
  await report({ type: "progress", value: 0.95 });
  expect(finishes()).toEqual([]);
  // Half of 2 minutes is 60 s.
  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
  });
  expect(await screen.findByText("Section finished")).toBeOnTheScreen();
  await report({ type: "progress", value: 1 });
  expect(finishes()).toEqual([
    {
      url: "/api/read/finish",
      method: "POST",
      body: { itemId: "5", momentId: "9", method: "auto" },
    },
  ]);
  expect(screen).toHavePathname("/read/5");
});

test("short of 90%, an unmeasurable section or a stray message: never finished", async () => {
  jest.useFakeTimers();
  answer({ ...measured, measure: { ...measured.measure, minutes: 1 } });
  await renderRouter("./app", { initialUrl: OPEN });
  await screen.findByText("blog.dev");
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  await act(async () => {
    // A one-minute section still waits 30 s.
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
  });
  await report({ type: "progress", value: 0.85 });
  await report({ type: "progress", value: 7 });
  await report("not the script");
  await report({ type: "unmeasurable" });
  expect(finishes()).toEqual([]);
  expect(warn).toHaveBeenCalledWith(
    "reader: the section isn't in the page",
    expect.anything(),
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
  expect(screen.queryByText("Section finished")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(15_000);
    await Promise.resolve();
  });
  expect(await screen.findByText("Section finished")).toBeOnTheScreen();
  expect(finishes()).toHaveLength(2);
  warn.mockRestore();
});
