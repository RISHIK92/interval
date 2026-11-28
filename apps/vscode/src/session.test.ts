import type { AgentStatus } from "@interval/api-client";
import { expect, test } from "vitest";
import { choices, printable } from "./session";
import { readSite } from "./site";

const setting = readSite("https://interval.example");
if (setting.kind !== "ok") throw new Error("the test site is refused");
const site = setting.site;

function status(suggestions: AgentStatus["suggestions"]): AgentStatus {
  return { task: { state: "idle" }, suggestions };
}

test("each suggestion shows its title and minutes", () => {
  expect(
    choices(
      status([
        {
          title: "Why consensus",
          minutes: 2,
          url: "https://interval.example/read/10?pos=1",
        },
        {
          title: "Raft, slowly",
          minutes: null,
          url: "https://interval.example/out/11",
        },
      ]),
      site,
    ),
  ).toEqual([
    {
      label: "Why consensus · 2 min",
      url: "https://interval.example/read/10?pos=1",
    },
    { label: "Raft, slowly", url: "https://interval.example/out/11" },
  ]);
});

test("a suggestion off the site is refused, the others stay", () => {
  expect(
    choices(
      status([
        { title: "Elsewhere", minutes: 3, url: "https://evil.example/read/10" },
        {
          title: "Downgraded",
          minutes: 3,
          url: "http://interval.example/read/10",
        },
        { title: "Here", minutes: 3, url: "https://interval.example/read/12" },
      ]),
      site,
    ).map((choice) => choice.label),
  ).toEqual(["Here · 3 min"]);
});

test("control characters never reach a title", () => {
  expect(printable("Line\u0000 one\nfake\u001b[31m line\u0007\u009b")).toBe(
    "Line onefake[31m line",
  );
  expect(
    choices(
      status([
        { title: "A\r\nB", minutes: 1, url: "https://interval.example/r" },
      ]),
      site,
    ),
  ).toEqual([{ label: "AB · 1 min", url: "https://interval.example/r" }]);
});

test("format characters are dropped and a title can't draw an icon", () => {
  expect(printable("Safe\u202eexe.txt\u200b\ufeff")).toBe("Safeexe.txt");
  expect(
    choices(
      status([
        {
          title: "$(warning) Update now",
          minutes: 2,
          url: "https://interval.example/r",
        },
      ]),
      site,
    ),
  ).toEqual([
    {
      label: "\\$(warning) Update now · 2 min",
      url: "https://interval.example/r",
    },
  ]);
});
