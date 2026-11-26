import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Explore } from "../../../server/ports";

// ADR-0046: "Close the gap" opens only the user's own current gap, counted once.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const gap = vi.fn<Explore["gap"]>(() =>
  Promise.resolve({
    conceptId: "77",
    concept: "Consistency models",
    topic: "distributed-systems",
    known: ["Caching", "Replication"],
    itemId: "5",
    momentId: "9",
    minutes: 6,
  }),
);
const emit = vi.fn();
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  explore: () => ({ gap }),
  events: () => ({ emit }),
}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: null };

async function open(query: string): Promise<Response> {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost:3100/explore/gap?${query}`));
}

test("the current gap opens its shortest moment through /out, counted", async () => {
  current.mockResolvedValue(ada);
  const res = await open("concept=77");
  expect(res.headers.get("location")).toBe(
    "/out?item=5&moment=9&from=explore&target=section",
  );
  expect(emit).toHaveBeenCalledWith(
    "gap_opened",
    { concept_id: "77" },
    expect.objectContaining({ userId: "u1" }),
  );
});

test("another concept, a guest or a bad link goes back to Explore, uncounted", async () => {
  current.mockResolvedValue(ada);
  expect((await open("concept=78")).headers.get("location")).toBe("/explore");
  expect((await open("concept=x")).headers.get("location")).toBe("/explore");
  current.mockResolvedValue({ ...ada, isGuest: true });
  expect((await open("concept=77")).headers.get("location")).toBe("/explore");
  expect(emit).not.toHaveBeenCalled();
});
