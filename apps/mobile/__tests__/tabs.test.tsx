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

test("/explore opens its own area", async () => {
  await renderRouter("./app", { initialUrl: "/explore" });
  expect(
    await screen.findByText("Arrives in a later phase."),
  ).toBeOnTheScreen();
});

// P4-W23-S02: Library holds the audio queue (its tests: listen.test.tsx).
test("/library opens the audio queue", async () => {
  await renderRouter("./app", { initialUrl: "/library" });
  expect(await screen.findByText("Audio queue")).toBeOnTheScreen();
});

// P4-W21-S01: Play is filled (its tests: play.test.tsx); here, its tab opens it.
test("/play opens Play", async () => {
  await renderRouter("./app", { initialUrl: "/play" });
  expect(await screen.findByText("Couldn't load Play.")).toBeOnTheScreen();
});
