import { act, fireEvent, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";

// P4-W19-S03 (ADR-0016, Q-P4-02): signed out, the app shows only sign-in; the same
// accounts as the web, no sign-up and no guests.
const fakeAuth =
  jest.requireMock<typeof import("../test/fake-auth")>("../lib/auth").fake;

test("signed out, sign-in is all there is", async () => {
  fakeAuth.signedOut();
  await renderRouter("./app", { initialUrl: "/" });
  expect(
    await screen.findByRole("header", { name: "Sign in" }),
  ).toBeOnTheScreen();
  expect(screen.queryByText("Library")).toBeNull();
  expect(screen.getByText(/invite-only: join on the web/)).toBeOnTheScreen();
});

test("a wrong password says so and stays on sign-in", async () => {
  fakeAuth.signedOut();
  fakeAuth.signIn.mockResolvedValueOnce({ error: { status: 401 } });
  await renderRouter("./app", { initialUrl: "/" });
  await fireEvent.changeText(
    await screen.findByLabelText("Email"),
    "ada@example.test",
  );
  await fireEvent.changeText(screen.getByLabelText("Password"), "wrong-one");
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("Wrong email or password.")).toBeOnTheScreen();
  expect(fakeAuth.signIn).toHaveBeenCalledWith({
    email: "ada@example.test",
    password: "wrong-one",
  });
});

test("signing in opens the tabs; Profile shows who, and Sign out goes back", async () => {
  fakeAuth.signedOut();
  fakeAuth.signIn.mockResolvedValueOnce({ error: null });
  await renderRouter("./app", { initialUrl: "/" });
  await fireEvent.changeText(
    await screen.findByLabelText("Email"),
    "ada@example.test",
  );
  await fireEvent.changeText(screen.getByLabelText("Password"), "the-password");
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText(/Couldn't load your feed/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText("Profile"));
  expect(await screen.findByText("ada@example.test")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
  expect(
    await screen.findByRole("header", { name: "Sign in" }),
  ).toBeOnTheScreen();
});

// A refetch (back from the password manager, a reconnect) mustn't wipe what's typed.
test("a session refetch keeps a half-typed sign-in", async () => {
  fakeAuth.signedOut();
  await renderRouter("./app", { initialUrl: "/" });
  await fireEvent.changeText(
    await screen.findByLabelText("Email"),
    "ada@example.test",
  );
  await act(() => {
    fakeAuth.refetching(true);
  });
  await act(() => {
    fakeAuth.refetching(false);
  });
  expect(screen.getByLabelText("Email").props.value).toBe("ada@example.test");
});

// P4-W21-S03: every screen is behind sign-in; a deep link signed out lands there.
test.each([
  "/boards",
  "/paths/3",
  "/read/5",
  "/quiz/40",
  "/live/sprint",
  "/books/4",
  "/books/4/checkpoint/8",
])("signed out, %s opens sign-in", async (url) => {
  fakeAuth.signedOut();
  await renderRouter("./app", { initialUrl: url });
  expect(
    await screen.findByRole("header", { name: "Sign in" }),
  ).toBeOnTheScreen();
});
