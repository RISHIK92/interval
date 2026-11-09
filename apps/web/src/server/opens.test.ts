import { expect, test, vi } from "vitest";

vi.mock("./container", () => ({}));

// P4-W20-S03 (§5D): the marker the app's reader looks for, from a stored section link.
test.each([
  ["https://blog.dev/raft#leader-election", { id: "leader-election" }],
  ["https://blog.dev/raft#caf%C3%A9", { id: "café" }],
  [
    "https://blog.dev/raft#:~:text=Leader%20election%20%2D%20terms",
    { text: "Leader election - terms" },
  ],
  [
    "https://blog.dev/raft#:~:text=Commas%2C%20too,end",
    { text: "Commas, too" },
  ],
  ["https://blog.dev/raft", null],
  ["https://blog.dev/raft#", null],
  ["https://blog.dev/raft#%E0%A4%A", null],
])("%s", async (link, marker) => {
  const { sectionMarker } = await import("./opens");
  expect(sectionMarker(link)).toEqual(marker);
});
