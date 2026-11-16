import { expect, test } from "vitest";
import { gradesFrom } from "./hld-grades";

// P6-W41 (Q-P6-05): the owner's grade per criterion, from the appeal and calibration
// forms.
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

test("every criterion needs a level from 0 to 4; a reason is optional", () => {
  expect(
    gradesFrom(
      form({ "level:a": "3", "reason:a": " Good. ", "level:b": "0" }),
      ["a", "b"],
    ),
  ).toEqual({
    a: { level: 3, reason: "Good." },
    b: { level: 0, reason: "Graded by the owner." },
  });
  expect(gradesFrom(form({ "level:a": "5" }), ["a"])).toBeNull();
  expect(gradesFrom(form({ "level:a": "2" }), ["a", "b"])).toBeNull();
});
