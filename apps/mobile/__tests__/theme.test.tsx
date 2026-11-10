import { screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { StyleSheet } from "react-native";

// P4-W19-S02 (ARCH-3): the app takes the design system's colors for the device's scheme.
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => "dark",
}));

test("in dark mode, the page and its text are the tokens' dark values", async () => {
  await renderRouter("./app", { initialUrl: "/explore" });
  const title = await screen.findByRole("header", { name: "Explore" });
  expect(StyleSheet.flatten(title.props.style)).toMatchObject({
    color: "#f3f4f6",
  });
  // The Placeholder's page: the title's parent view.
  expect(StyleSheet.flatten(title.parent?.props.style)).toMatchObject({
    backgroundColor: "#0e1014",
  });
  const note = screen.getByText("Arrives in a later phase.");
  expect(StyleSheet.flatten(note.props.style)).toMatchObject({
    color: "#8f95a1",
  });
});
