// Every screen test runs against the fake auth client (test/fake-auth.ts), signed in.
jest.mock("../lib/auth", () => jest.requireActual<object>("./fake-auth"));

beforeEach(() => {
  jest.requireMock<typeof import("./fake-auth")>("../lib/auth").fake.signedIn();
});
