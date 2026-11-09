import { fireEvent, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";

// P4-W19-S01 (§4.1, Q-P4-01): the five areas as tabs, Profile from the avatar.
test("the five areas are tabs, Home first", async () => {
  await renderRouter("./app", { initialUrl: "/" });
  for (const tab of ["Home", "Explore", "Paths", "Play", "Library"])
    expect(await screen.findAllByText(tab)).not.toHaveLength(0);
  // P4-W20-S01: Home is the feed (here with no network).
  expect(await screen.findByText(/Couldn't load your feed/)).toBeOnTheScreen();
});

test("the avatar opens Profile", async () => {
  await renderRouter("./app", { initialUrl: "/" });
  await fireEvent.press(await screen.findByLabelText("Profile"));
  expect(await screen.findByText("Signed in as")).toBeOnTheScreen();
});

test.each([
  ["/explore", "a later phase"],
  ["/paths", "W21-S03"],
  ["/play", "W21-S01"],
  ["/library", "W23-S01"],
])("%s opens its own area", async (url, arrives) => {
  await renderRouter("./app", { initialUrl: url });
  expect(await screen.findByText(`Arrives in ${arrives}.`)).toBeOnTheScreen();
});
