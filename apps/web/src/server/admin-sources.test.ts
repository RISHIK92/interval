import { expect, test, vi } from "vitest";
import { switchMoments } from "./admin-sources";
import type { AdminSources, JobQueue, SourceSwitch } from "./ports";

// §3.2, P1-W3-S06: switching a source's moments off or back on.
const source: SourceSwitch = {
  id: "3",
  name: "Blog",
  rightsProfile: "full_text_internal",
  active: true,
  momentsSeeded: true,
  momentsSwitchedOff: false,
  momentsEnabled: true,
};

function fakes(found: SourceSwitch | null = source) {
  const sources = {
    list: vi.fn(),
    get: vi.fn(() => Promise.resolve(found)),
    setMomentsSwitchedOff: vi.fn(() => Promise.resolve()),
    fullTextItemIds: vi.fn(() => Promise.resolve(["10", "11"])),
  } satisfies AdminSources;
  const queue = { enqueue: vi.fn(() => Promise.resolve()) } satisfies JobQueue;
  return { sources, queue };
}

test("switching off stores the switch and segments nothing", async () => {
  const { sources, queue } = fakes();
  expect(await switchMoments(sources, queue, "admin-1", "3", true)).toEqual({
    ok: true,
  });
  expect(sources.setMomentsSwitchedOff).toHaveBeenCalledWith(
    "3",
    true,
    "admin-1",
  );
  expect(queue.enqueue).not.toHaveBeenCalled();
});

test("switching back on segments the source's full-text items again", async () => {
  const { sources, queue } = fakes({
    ...source,
    momentsSwitchedOff: true,
    momentsEnabled: false,
  });
  await switchMoments(sources, queue, "admin-1", "3", false);
  expect(sources.setMomentsSwitchedOff).toHaveBeenCalledWith(
    "3",
    false,
    "admin-1",
  );
  expect(queue.enqueue).toHaveBeenCalledTimes(2);
  expect(queue.enqueue).toHaveBeenCalledWith(
    "segment_item",
    { content_item_id: 10 },
    expect.anything(),
  );
});

test("when the seed file has moments off, clearing the switch segments nothing", async () => {
  const { sources, queue } = fakes({
    ...source,
    momentsSeeded: false,
    momentsSwitchedOff: true,
  });
  await switchMoments(sources, queue, "admin-1", "3", false);
  expect(queue.enqueue).not.toHaveBeenCalled();
});

test("asking for the state a source is already in does nothing", async () => {
  const { sources, queue } = fakes();
  expect(await switchMoments(sources, queue, "a", "3", false)).toEqual({
    ok: true,
  });
  expect(sources.setMomentsSwitchedOff).not.toHaveBeenCalled();
  expect(queue.enqueue).not.toHaveBeenCalled();
});

test("an unknown source is refused", async () => {
  const { sources, queue } = fakes(null);
  expect(await switchMoments(sources, queue, "a", "9", true)).toEqual({
    ok: false,
  });
  expect(sources.setMomentsSwitchedOff).not.toHaveBeenCalled();
});
