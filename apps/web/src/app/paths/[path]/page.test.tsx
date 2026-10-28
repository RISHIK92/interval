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
const alternatives = vi.fn<Paths["alternatives"]>(() => Promise.resolve([]));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get }),
  paths: () => ({ path, alternatives }),
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
      skipped: false,
      warning: null,
      holdsBack: true,
      readings: [
        {
          ...reading,
          momentId: "900",
          itemId: "50",
          sectionTitle: "Leaders",
          frameable: true,
          finished: true,
          ordinal: 0,
        },
        {
          ...reading,
          momentId: "901",
          itemId: "51",
          sectionTitle: "Followers",
          frameable: false,
          finished: false,
          ordinal: 1,
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
      skipped: false,
      warning: null,
      holdsBack: true,
      readings: [
        {
          ...reading,
          momentId: "902",
          itemId: "52",
          sectionTitle: "Majorities",
          frameable: true,
          finished: false,
          ordinal: 0,
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

// P2-W10-S05 (C-25, Q-P2-23): Edit mode on the user's own copy.
test("Edit shows its controls only to a follower of a live path", async () => {
  current.mockResolvedValue(user);
  path.mockResolvedValue(timeline);
  const view = await page();
  expect(view).toContain('href="/paths/6?edit=1"');
  expect(view).not.toContain("Skip section");
  const html = await page({ edit: "1" });
  expect(html).toContain("Done editing");
  expect(html).toContain('name="edit" value="pause"');
  // No Up on the first section, no Down on the last.
  expect(html).not.toContain(
    'aria-label="Move Leader-follower replication up"',
  );
  expect(html).toContain('aria-label="Move Leader-follower replication down"');
  expect(html).toContain('aria-label="Move Quorums up"');
  expect(html).not.toContain('aria-label="Move Quorums down"');
  // Skip asks first; a finished reading has no Swap.
  expect(html).toContain('popover="auto"');
  expect(html).toContain("Skip Leader-follower replication?");
  expect(html).toContain(
    'aria-label="Skip section Leader-follower replication"',
  );
  expect(html).toContain('aria-label="Swap Followers"');
  expect(html).not.toContain('aria-label="Swap Leaders"');
  for (const other of [
    { ...timeline, mine: null },
    { ...timeline, retired: true, mine: "paused" as const },
  ]) {
    path.mockResolvedValueOnce(other);
    const shown = await page({ edit: "1" });
    expect(shown).not.toContain("Edit path");
    expect(shown).not.toContain("Skip section");
  }
});

test("a skipped section can be unskipped; a moved one is flagged; swap lists alternatives", async () => {
  current.mockResolvedValue(user);
  const [one, two] = timeline.sections;
  if (!one || !two) throw new Error("fixture");
  path.mockResolvedValue({
    ...timeline,
    sections: [
      {
        ...two,
        open: true,
        checkpoint: "reading",
        warning: ["Leader-follower replication"],
      },
      { ...one, skipped: true, checkpoint: "skipped" },
    ],
  });
  alternatives.mockResolvedValueOnce([
    {
      momentId: "905",
      sectionTitle: "Read quorums",
      articleTitle: "Dynamo",
      sourceName: "Pub",
      minutes: 6,
    },
  ]);
  const html = await page({ edit: "1", swap: "60.1" });
  expect(html).toContain('aria-label="Swap Followers for"');
  expect(html).toContain('aria-label="Use this: Read quorums"');
  expect(alternatives).toHaveBeenCalledWith("u1", "60", 1);
  expect(html).toContain(
    "Moved ahead of Leader-follower replication, which this path teaches first.",
  );
  expect(html).toContain("Skipped · no checkpoint");
  expect(html).toContain('aria-label="Unskip Leader-follower replication"');
  expect(html).toMatch(
    /name="edit" value="swap"[^]*?name="sectionId" value="60"[^]*?name="ordinal" value="1"[^]*?name="momentId" value="905"[^]*?Use this/,
  );
  // A bad swap key lists nothing.
  alternatives.mockClear();
  await page({ edit: "1", swap: "x" });
  // Past a smallint: no session, and no query that would fail.
  await page({ edit: "1", swap: "60.40000" });
  expect(alternatives).not.toHaveBeenCalled();
});
