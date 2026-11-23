import { expect, test } from "vitest";
import { memorySoloLocks } from "./adapters/valkey-solo-locks";
import { claimSolo } from "./solo";

// P5-W32 (Q-P5-19): one solo at a time; one that ended, even early, frees the claim.
test("a second solo waits on the first while its match is on", async () => {
  const locks = memorySoloLocks();
  const ended = () => Promise.resolve(false);
  expect(await claimSolo({ locks, ended }, "u1", "battle")).toEqual({
    allowed: true,
  });
  await locks.bind("u1", "battle", "m1");
  expect(await claimSolo({ locks, ended }, "u1", "battle")).toEqual({
    allowed: false,
    matchId: "m1",
  });
});

test("a solo that ended early frees the claim for the next", async () => {
  const locks = memorySoloLocks();
  const done = new Set<string>();
  const ended = (matchId: string) => Promise.resolve(done.has(matchId));
  expect(await claimSolo({ locks, ended }, "u1", "battle")).toEqual({
    allowed: true,
  });
  await locks.bind("u1", "battle", "m1");
  done.add("m1");
  expect(await claimSolo({ locks, ended }, "u1", "battle")).toEqual({
    allowed: true,
  });
  // The new claim is held until its own match is made.
  expect(await claimSolo({ locks, ended }, "u1", "battle")).toEqual({
    allowed: false,
    matchId: null,
  });
});
