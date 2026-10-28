import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Paths,
  PathTimeline,
  Preferences,
} from "../../../server/ports";

// §5F, wireframe 05, Q-P2-27 (P2-W10-S03): a path's timeline.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const get = vi.fn<(userId: string) => Promise<Preferences | null>>(() =>
  Promise.resolve({
    goals: [],
    topics: ["backend"],
    level: "beginner",
    breakLength: "3-8",
    firstName: null,
  }),
);
const path = vi.fn<Paths["path"]>();
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get }),
  paths: () => ({ path }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

const reading = {
  articleTitle: "Designing data systems",
  sourceName: "Pub Engineering",
  minutes: 4,
  linkBroken: false,
};
const timeline: PathTimeline = {
  pathId: "6",
  name: "Replication",
  why: "How copies stay close.",
  retired: false,
  mine: "active",
  sections: [
    {
      sectionId: "60",
      concepts: ["Leader-follower replication"],
      open: true,
      checkpoint: "reading",
      size: 5,
      passMark: 4,
      readings: [
        {
          ...reading,
          momentId: "900",
          itemId: "50",
          sectionTitle: "Leaders",
          frameable: true,
          finished: true,
        },
        {
          ...reading,
          momentId: "901",
          itemId: "51",
          sectionTitle: "Followers",
          frameable: false,
          finished: false,
        },
      ],
    },
    {
      sectionId: "61",
      concepts: ["Quorums"],
      open: false,
      checkpoint: "locked",
      size: 2,
      passMark: 1,
      readings: [
        {
          ...reading,
          momentId: "902",
          itemId: "52",
          sectionTitle: "Majorities",
          frameable: true,
          finished: false,
        },
      ],
    },
  ],
};

async function page(
  query: Record<string, string> = {},
  id = "6",
): Promise<string> {
  const { default: PathPage } = await import("./page");
  return renderToStaticMarkup(
    await PathPage({
      params: Promise.resolve({ path: id }),
      searchParams: Promise.resolve(query),
    }),
  );
}

test("the timeline ticks finished readings, offers the next, and shows checkpoints and locks", async () => {
  current.mockResolvedValue(user);
  path.mockResolvedValue(timeline);
  const html = await page();
  expect(path).toHaveBeenCalledWith("u1", "6");
  expect(html).toContain("Replication");
  expect(html).toContain("Leader-follower replication");
  // Finished, in words as well as a mark.
  expect(html).toMatch(/Leaders[^]*?Finished/);
  // The next unfinished reading is the call to action; one the reader can't frame
  // opens in the browser through /out, still as a path open.
  expect(html.replace(/<[^>]+>/g, "")).toContain("Next: Followers");
  expect(html).toContain(
    'href="/out?item=51&amp;moment=901&amp;from=path&amp;target=section"',
  );
  // A framed reading opens in the reader, coming back here.
  expect(html).toContain(
    'href="/read/50?moment=900&amp;chip=3-8&amp;from=path&amp;path=6"',
  );
  expect(html).toContain("Checkpoint · Pass 4 of 5 to unlock Quorums");
  expect(html).toContain(
    "Locked · unlocks after the Leader-follower replication checkpoint",
  );
  // A locked section's readings aren't links yet.
  expect(html).not.toContain("/read/52");
});

test("a section's checkpoint is offered once its readings are finished, on the active path", async () => {
  current.mockResolvedValue(user);
  const [one, two] = timeline.sections;
  if (!one || !two) throw new Error("fixture");
  const ready = {
    ...timeline,
    sections: [{ ...one, checkpoint: "ready" as const }, two],
  };
  path.mockResolvedValueOnce(ready);
  const html = await page();
  expect(html).toMatch(
    /name="sectionId" value="60"[^]*?name="chip" value="3-8"[^]*?Take the checkpoint/,
  );
  // Not while the readings are unfinished, nor on a path that isn't active.
  path.mockResolvedValueOnce(timeline);
  expect(await page()).not.toContain("Take the checkpoint");
  path.mockResolvedValueOnce({ ...ready, mine: "paused" });
  expect(await page()).not.toContain("Take the checkpoint");
  // Passed: the next section opens, its smaller checkpoint needing all but one.
  path.mockResolvedValueOnce({
    ...timeline,
    sections: [
      { ...one, checkpoint: "passed" },
      { ...two, open: true, checkpoint: "reading" },
    ],
  });
  const passed = await page();
  expect(passed).toContain("Checkpoint passed");
  expect(passed).toContain("Checkpoint · Pass 1 of 2 to finish the path");
  expect(passed).not.toContain("Locked");
  path.mockResolvedValueOnce({
    ...timeline,
    sections: [{ ...one, checkpoint: "no_questions", size: 0 }, two],
  });
  expect(await page()).toContain("Checkpoint not ready yet");
});

test("a path the user hasn't started offers Start; a retired one says so", async () => {
  current.mockResolvedValue(user);
  path.mockResolvedValueOnce({ ...timeline, mine: null });
  const fresh = await page();
  expect(fresh).toMatch(/name="pathId" value="6"[^]*?Start this path/);
  path.mockResolvedValueOnce({ ...timeline, retired: true });
  expect(await page()).toContain("This path was retired");
});

test("ask= opens the Finished? prompt coming back from a reading", async () => {
  current.mockResolvedValue(user);
  path.mockResolvedValue(timeline);
  const html = await page({ ask: "50.900" });
  expect(html).toContain('aria-label="Finished reading?"');
  expect(html).toContain('name="back" value="/paths/6"');
  expect(await page()).not.toContain('aria-label="Finished reading?"');
});

test("an unknown path is not found; bad ids go to the list", async () => {
  current.mockResolvedValue(user);
  path.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("notFound");
  await expect(page({}, "x")).rejects.toThrow("redirect:/paths");
});
