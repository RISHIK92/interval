// Every screen test runs against the fake auth client (test/fake-auth.ts), signed in.
jest.mock("../lib/auth", () => jest.requireActual<object>("./fake-auth"));
// Notifications not allowed unless a test says so (P4-W19-S04a).
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
}));

beforeEach(() => {
  jest.requireMock<typeof import("./fake-auth")>("../lib/auth").fake.signedIn();
});
