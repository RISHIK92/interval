import { fireEvent, screen } from "@testing-library/react-native";
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
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
});
afterEach(() => {
  jest.clearAllMocks();
});

const sent = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url,
    method: init.method,
    body:
      typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null,
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
  expect(fetchMock).not.toHaveBeenCalled();
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
