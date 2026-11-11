import { act, fireEvent, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import * as Notifications from "expo-notifications";

// P4-W19-S04a (Q-P4-03): on a tap, the app asks for permission, gets the phone's push
// token and registers it; Turn off removes it.
const mocked = jest.mocked(Notifications);
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();

beforeEach(() => {
  mocked.getPermissionsAsync.mockResolvedValue({
    granted: false,
  } as Notifications.NotificationPermissionsStatus);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Profile's read of the push settings (P4-W24-S01) answers as a plan without push,
  // unless a test says otherwise; the rest are this phone's registration calls.
  fetchMock.mockImplementation((url) =>
    Promise.resolve(
      new Response(null, {
        status: url.endsWith("/api/push/preferences") ? 403 : 204,
      }),
    ),
  );
});
afterEach(() => {
  jest.clearAllMocks();
});

// This phone's registration calls: Profile's read of the push settings (P4-W24-S01) left
// out.
const sent = () =>
  fetchMock.mock.calls
    .filter(([url]) => !url.endsWith("/api/push/preferences"))
    .map(([url, init]) => ({
      url,
      method: init.method,
      body:
        typeof init.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : null,
      headers: init.headers,
    }));

test("Notify me on this phone asks, registers its token, and says it's on", async () => {
  mocked.requestPermissionsAsync.mockResolvedValue({
    granted: true,
  } as Notifications.NotificationPermissionsStatus);
  mocked.getDevicePushTokenAsync.mockResolvedValue({
    type: "ios",
    data: "a1b2c3",
  });
  await renderRouter("./app", { initialUrl: "/profile" });
  expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  await fireEvent.press(
    await screen.findByRole("button", { name: "Notify me on this phone" }),
  );
  expect(await screen.findByText("Notifications are on.")).toBeOnTheScreen();
  expect(sent()).toEqual([
    {
      url: "http://localhost:3100/api/push/device",
      method: "POST",
      body: { platform: "ios", token: "a1b2c3" },
      headers: expect.objectContaining({
        "expo-origin": "interval://",
        cookie: "better-auth.session_token=test",
      }) as unknown,
    },
  ]);
  await fireEvent.press(screen.getByRole("button", { name: "Turn off" }));
  expect(
    await screen.findByRole("button", { name: "Notify me on this phone" }),
  ).toBeOnTheScreen();
  expect(sent()[1]).toMatchObject({
    method: "DELETE",
    body: { token: "a1b2c3" },
  });
});

test("a denied permission says so and registers nothing", async () => {
  mocked.requestPermissionsAsync.mockResolvedValue({
    granted: false,
  } as Notifications.NotificationPermissionsStatus);
  await renderRouter("./app", { initialUrl: "/profile" });
  await fireEvent.press(
    await screen.findByRole("button", { name: "Notify me on this phone" }),
  );
  expect(
    await screen.findByText(/Notifications are blocked in Settings/),
  ).toBeOnTheScreen();
  expect(sent()).toEqual([]);
});

test("a plan without push says so", async () => {
  mocked.requestPermissionsAsync.mockResolvedValue({
    granted: true,
  } as Notifications.NotificationPermissionsStatus);
  mocked.getDevicePushTokenAsync.mockResolvedValue({
    type: "android",
    data: "fcm-token",
  });
  fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
  await renderRouter("./app", { initialUrl: "/profile" });
  await fireEvent.press(
    await screen.findByRole("button", { name: "Notify me on this phone" }),
  );
  expect(
    await screen.findByText("Notifications aren't on your plan."),
  ).toBeOnTheScreen();
});

// After a restart, a phone whose notifications are allowed shows Turn off, which needs
// no capability (ADR-0036).
test("after a restart, Turn off is there and removes the phone's token", async () => {
  mocked.getPermissionsAsync.mockResolvedValue({
    granted: true,
  } as Notifications.NotificationPermissionsStatus);
  mocked.getDevicePushTokenAsync.mockResolvedValue({ type: "ios", data: "t1" });
  await renderRouter("./app", { initialUrl: "/profile" });
  await fireEvent.press(
    await screen.findByRole("button", { name: "Turn off" }),
  );
  expect(sent()).toEqual([
    expect.objectContaining({ method: "DELETE", body: { token: "t1" } }),
  ]);
  expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
});

test("signing out removes the phone's token first", async () => {
  mocked.getPermissionsAsync.mockResolvedValue({
    granted: true,
  } as Notifications.NotificationPermissionsStatus);
  mocked.getDevicePushTokenAsync.mockResolvedValue({ type: "ios", data: "t1" });
  await renderRouter("./app", { initialUrl: "/profile" });
  await fireEvent.press(
    await screen.findByRole("button", { name: "Sign out" }),
  );
  expect(
    await screen.findByRole("header", { name: "Sign in" }),
  ).toBeOnTheScreen();
  expect(sent()).toEqual([
    expect.objectContaining({ method: "DELETE", body: { token: "t1" } }),
  ]);
});

// P4-W24-S01 (Q-P4-13): which pushes and when; each change saves with the phone's zone.
test("push settings load, and a switch or the hour saves at once", async () => {
  fetchMock.mockImplementation((url, init) =>
    Promise.resolve(
      url.endsWith("/api/push/preferences") && init.method === "GET"
        ? Response.json({
            digest: false,
            pathReminder: false,
            dailyChallenge: true,
            hour: 20,
          })
        : new Response(null, { status: 204 }),
    ),
  );
  await renderRouter("./app", { initialUrl: "/profile" });
  expect(await screen.findByLabelText("Hour 20:00")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Later" })).toBeDisabled();
  await fireEvent(
    screen.getByLabelText("Your break is ready"),
    "valueChange",
    true,
  );
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  expect(fetchMock).toHaveBeenLastCalledWith(
    "http://localhost:3100/api/push/preferences",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        digest: true,
        pathReminder: false,
        dailyChallenge: true,
        hour: 20,
        timeZone: zone,
      }),
    }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Earlier" }));
  expect(await screen.findByLabelText("Hour 19:00")).toBeOnTheScreen();
});

test("a plan without push shows no push settings", async () => {
  fetchMock.mockImplementation((url) =>
    Promise.resolve(
      new Response(null, {
        status: url.endsWith("/api/push/preferences") ? 403 : 204,
      }),
    ),
  );
  await renderRouter("./app", { initialUrl: "/profile" });
  expect(await screen.findByText("Signed in as")).toBeOnTheScreen();
  expect(screen.queryByText("Notifications")).toBeNull();
});

test("a save that fails goes back to what the server last confirmed", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  fetchMock.mockImplementation((url, init) =>
    Promise.resolve(
      url.endsWith("/api/push/preferences") && init.method === "GET"
        ? Response.json({
            digest: false,
            pathReminder: false,
            dailyChallenge: false,
            hour: 18,
          })
        : new Response(null, { status: 500 }),
    ),
  );
  await renderRouter("./app", { initialUrl: "/profile" });
  const daily = await screen.findByLabelText("Daily challenge");
  await fireEvent(daily, "valueChange", true);
  expect(
    await screen.findByText("Couldn’t save. Try again."),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText("Daily challenge")).toHaveProp("value", false);
  warn.mockRestore();
});

// P4-W24-S01b: a tapped notification opens the page it names, once.
const tap = (url: unknown) =>
  ({
    notification: {
      request: { identifier: "n1", content: { data: { url } } },
    },
  }) as unknown as Notifications.NotificationResponse;

test("the notification that launched the app opens its page, then is cleared", async () => {
  mocked.getLastNotificationResponse.mockReturnValueOnce(tap("/play"));
  await renderRouter("./app", { initialUrl: "/" });
  expect(await screen.findByText("Couldn't load Play.")).toBeOnTheScreen();
  expect(mocked.clearLastNotificationResponse).toHaveBeenCalled();
});

test("one tapped while the app runs opens too; another site's never", async () => {
  await renderRouter("./app", { initialUrl: "/library" });
  await screen.findByText("Audio queue");
  const listener =
    mocked.addNotificationResponseReceivedListener.mock.calls[0]?.[0];
  if (listener === undefined) throw new Error("no listener");
  for (const away of [
    "//evil.test/x",
    "/\\evil.test",
    "https://evil.test",
    7,
  ]) {
    await act(async () => {
      listener(tap(away));
      await Promise.resolve();
    });
    expect(screen.getByText("Audio queue")).toBeOnTheScreen();
  }
  await act(async () => {
    listener(tap("/play"));
    await Promise.resolve();
  });
  expect(await screen.findByText("Couldn't load Play.")).toBeOnTheScreen();
});
