import { Diagram, describeDiagram } from "@interval/diagrams";
import { render, screen } from "@testing-library/react-native";
import { DiagramSvg } from "../components/DiagramSvg";

// P4.5-W25-S01 (ARCH-3, TTS-5): the app draws the same shared description as the web.
const diagram = Diagram.parse({
  title: "Every kind",
  shapes: [
    { id: "app", kind: "client", label: "App", at: { col: 0, row: 1 } },
    { id: "api", kind: "service", label: "API", at: { col: 4, row: 1 } },
    { id: "db", kind: "database", label: "DB", at: { col: 8, row: 1 } },
    { id: "hot", kind: "cache", label: "Cache", at: { col: 4, row: 4 } },
    { id: "q", kind: "queue", label: "Queue", at: { col: 8, row: 4 } },
    {
      id: "zone",
      kind: "group",
      label: "Zone",
      at: { col: 3, row: 0 },
      size: { cols: 8, rows: 7 },
    },
    { id: "tip", kind: "note", label: "Note", at: { col: 0, row: 4 } },
  ],
  arrows: [
    { from: "app", to: "api", label: "get" },
    { from: "api", to: "db", style: "dashed" },
  ],
});

test("an image named by its title, with every label and the theme's colours", async () => {
  await render(<DiagramSvg description={describeDiagram(diagram)} />);
  expect(screen.getByLabelText("Every kind")).toBeOnTheScreen();
  // react-native-svg draws text in its own native nodes (not React Native's Text), so
  // the labels are found in the rendered tree.
  const json = JSON.stringify(screen.toJSON());
  for (const words of [
    "App",
    "API",
    "DB",
    "Cache",
    "Queue",
    "Zone",
    "Note",
    "get",
  ])
    expect(json).toContain(`"content":"${words}"`);
  // The web's dominantBaseline, under react-native-svg's name; the dashed arrow.
  expect(json).toContain('"alignmentBaseline":"central"');
  expect(json).not.toContain("dominantBaseline");
  expect(json).toContain('"strokeDasharray":["6","4"]');
  // The light theme's ink (#101217, which react-native-svg packs as 0xff101217), never
  // a token name.
  expect(json).toContain(`"payload":${String(0xff101217)}`);
  expect(json).not.toContain('"ink"');
});
