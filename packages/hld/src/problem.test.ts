import { expect, test } from "vitest";
import { CLIPS, SHORTENER, SIGN_IN } from "./fixtures.test-helpers";
import { HldProblem } from "./problem";

// ADR-0050 §6, ADR-0051: a problem names a published spec version, and uses only what
// that version has: its kinds and its features' fields.
const issues = (problem: unknown) =>
  HldProblem.safeParse(problem).error?.issues.map((i) => i.message) ?? [];

test("a problem's spec version must be one that was published", () => {
  expect(issues({ ...SHORTENER, spec: "9.9" })).toEqual([
    "no such spec version",
  ]);
});

test("a 1.0 problem can't use what 2.0 brings", () => {
  const v1 = <T extends object>(p: T) => ({ ...p, spec: "1.0" });
  expect(issues(v1(SIGN_IN))).toEqual(
    expect.arrayContaining([
      "spec 1.0 has no external provider",
      'spec 1.0 has no "completionSeconds" (on "send_code")',
      'spec 1.0 has no "requires" (on "send_code")',
      'spec 1.0 has no "minutes" (in "provider_down")',
    ]),
  );
  expect(issues(v1(CLIPS))).toEqual(
    expect.arrayContaining([
      'spec 1.0 has no "work" (on "upload")',
      'spec 1.0 has no "payloadKb" (on "view")',
      'spec 1.0 has no "loads" (in "uploads")',
    ]),
  );
  expect(issues(SIGN_IN)).toEqual([]);
  expect(issues(CLIPS)).toEqual([]);
});

test("a request type requires only what the problem allows", () => {
  expect(
    issues({
      ...CLIPS,
      traffic: {
        ...CLIPS.traffic,
        requests: CLIPS.traffic.requests.map((r) =>
          r.type === "upload" ? { ...r, requires: ["external_api"] } : r,
        ),
      },
    }),
  ).toEqual(['"upload" requires external_api, which isn\'t allowed']);
});
