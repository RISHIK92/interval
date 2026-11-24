import { describe, expect, test } from "vitest";
import { calibrationCandidates } from "./judge";
import {
  calibrationFingerprint,
  calibrationSuggestions,
  candidateFingerprint,
} from "./suggestions";

// Claude's suggested grades (owner decision 2026-11-24, Q-WD-32): data for the owner to
// accept or change, so they must fit the calibration set they describe, every design of
// it, as it is now.
describe("calibration suggestions", () => {
  const candidates = new Map(calibrationCandidates().map((c) => [c.id, c]));
  const suggestions = calibrationSuggestions();

  test("each names a calibration design and exactly its rubric's criteria", () => {
    for (const [id, { levels }] of suggestions) {
      const candidate = candidates.get(id);
      expect(candidate, id).toBeDefined();
      expect(Object.keys(levels).sort(), id).toEqual(
        candidate?.input.rubric.map((r) => r.id).sort(),
      );
    }
  });

  test("every design has one, written for the design as it is now", () => {
    for (const candidate of candidates.values()) {
      expect(suggestions.get(candidate.id)?.fingerprint, candidate.id).toBe(
        candidateFingerprint(candidate),
      );
    }
  });

  test("the steering design is suggested what the same design without notes is", () => {
    for (const [id, { levels }] of suggestions) {
      if (!id.endsWith("/injection")) continue;
      const bare = suggestions.get(id.replace(/injection$/, "no-notes"));
      const level = (l: typeof levels) =>
        Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v.level]));
      expect(bare && level(bare.levels), id).toEqual(level(levels));
    }
  });

  test("a naive design is suggested 0 on every criterion", () => {
    for (const [id, { levels }] of suggestions) {
      if (!id.endsWith("/naive")) continue;
      for (const [criterion, s] of Object.entries(levels))
        expect(s.level, `${id} ${criterion}`).toBe(0);
    }
  });
});

describe("the fingerprint", () => {
  const [candidate] = calibrationCandidates();
  if (candidate === undefined) throw new Error("no calibration designs");
  const { input } = candidate;
  const print = (i = input, slug = "url-shortener", spec = "1.0") =>
    calibrationFingerprint(slug, spec, i);

  test("ignores key order", () => {
    const reordered = Object.fromEntries(
      Object.entries(input).reverse(),
    ) as typeof input;
    expect(print(reordered)).toBe(print());
  });

  test("changes with the design, the problem and the spec version", () => {
    const [first, ...rest] = input.components;
    if (first === undefined) throw new Error("no components");
    const renoted = {
      ...input,
      components: [{ ...first, note: `${first.note}!` }, ...rest],
    };
    const prints = new Set([
      print(),
      print(renoted),
      print(input, "other"),
      print(input, "url-shortener", "2.0"),
    ]);
    expect(prints.size).toBe(4);
    expect(print()).toMatch(/^[0-9a-f]{16}$/);
  });
});
