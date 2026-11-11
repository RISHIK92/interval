// Every screen test runs against the fake auth client (test/fake-auth.ts), signed in.
jest.mock("../lib/auth", () => jest.requireActual<object>("./fake-auth"));
// Notifications not allowed unless a test says so (P4-W19-S04a).
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  // P4-W24-S01b: no notification tapped, unless a test says one was.
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
}));

// Haptics are felt on a phone only; tests read which was asked for (P4-W21-S01).
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: "success", Error: "error" },
}));

// The publisher's page (P4-W20-S02): a native view jest can't load; its props are
// what the reader passes, and a test calls its onLoadEnd or onError.
jest.mock("react-native-webview", () => {
  const { createElement } = jest.requireActual<typeof import("react")>("react");
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    WebView: (props: object) =>
      createElement(View, { ...props, testID: "publisher-page" }),
  };
});

// A book's PDF (P4-W21-S04): the file is "fetched" to a path tests can read; the view
// renders its props, so tests can turn its pages.
jest.mock("react-native-blob-util", () => {
  const response = {
    info: () => ({ status: 200 }),
    path: () => "/cache/book.pdf",
  };
  // A StatefulPromise: a promise that can also be cancelled.
  const fetch = jest.fn(() =>
    Object.assign(Promise.resolve(response), {
      cancel: () => Promise.resolve(),
    }),
  );
  return {
    __esModule: true,
    default: {
      config: jest.fn(() => ({ fetch })),
      fetchMock: fetch,
      fs: {
        dirs: { CacheDir: "/cache" },
        ls: jest.fn(() => Promise.resolve([])),
        exists: jest.fn(() => Promise.resolve(true)),
        unlink: jest.fn(() => Promise.resolve()),
      },
    },
  };
});
jest.mock("react-native-pdf", () => {
  const { createElement } = jest.requireActual<typeof import("react")>("react");
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: (props: object) =>
      createElement(View, { ...props, testID: "book-pdf" }),
  };
});

// expo-audio (P4-W23-S02): a native player jest can't load. Screen tests only need it
// to exist; the store's own tests (listen.test.tsx) drive a fake of their own.
jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    replace: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    setPlaybackRate: jest.fn(),
    setActiveForLockScreen: jest.fn(),
    clearLockScreenControls: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  })),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  // No network in screen tests: a test that reads the API mocks fetch itself.
  globalThis.fetch = jest.fn(() =>
    Promise.resolve(new Response(null, { status: 503 })),
  );
  jest.requireMock<typeof import("./fake-auth")>("../lib/auth").fake.signedIn();
});
