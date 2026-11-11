import { describe as group, expect, test } from "vitest";
import { CELL, type Element } from "./describe";
import { Diagram, describeDiagram } from "./index";

// P4.5-W25-S01 (ARCH-3, TTS-5, CANVAS-1; Q-P4.5-01): the shared diagram library. Data
// (shapes on a grid) and a pure description of how to draw it, for both platforms.
const raft = Diagram.parse({
  title: "Raft replication",
  shapes: [
    { id: "app", kind: "client", label: "App", at: { col: 0, row: 1 } },
    { id: "leader", kind: "service", label: "Leader", at: { col: 4, row: 1 } },
    { id: "log", kind: "database", label: "Log", at: { col: 8, row: 1 } },
    { id: "hot", kind: "cache", label: "Cache", at: { col: 4, row: 4 } },
    { id: "q", kind: "queue", label: "Queue", at: { col: 8, row: 4 } },
    {
      id: "cluster",
      kind: "group",
      label: "Cluster",
      at: { col: 3, row: 0 },
      size: { cols: 8, rows: 7 },
    },
    { id: "tip", kind: "note", label: "Majority", at: { col: 0, row: 4 } },
  ],
  arrows: [
    { from: "app", to: "leader", label: "write" },
    { from: "leader", to: "log", style: "dashed" },
    { from: "app", to: "cluster" },
  ],
});

const all = (e: Element): Element[] => [e, ...(e.children ?? []).flatMap(all)];
const find = (els: Element[], key: string) => {
  const found = els.find((e) => e.key === key);
  if (found === undefined) throw new Error(`no ${key}`);
  return all(found);
};
const shapes = (...extra: object[]) => ({
  title: "x",
  shapes: [
    { id: "a", kind: "service", label: "A", at: { col: 0, row: 0 } },
    { id: "b", kind: "service", label: "B", at: { col: 5, row: 0 } },
    ...extra,
  ],
});
const ok = (d: object) => Diagram.safeParse(d).success;

group("the data", () => {
  test("refuses a duplicate id, an arrow to nothing, a place or size off the grid", () => {
    expect(ok({ ...shapes(), arrows: [] })).toBe(true);
    expect(
      ok({
        ...shapes({
          id: "a",
          kind: "note",
          label: "x",
          at: { col: 0, row: 6 },
        }),
        arrows: [],
      }),
    ).toBe(false);
    expect(ok({ ...shapes(), arrows: [{ from: "a", to: "z" }] })).toBe(false);
    // 22 + a service's 3 columns runs past 24.
    expect(
      ok({
        ...shapes({
          id: "c",
          kind: "service",
          label: "C",
          at: { col: 22, row: 4 },
        }),
        arrows: [],
      }),
    ).toBe(false);
    expect(
      ok({
        ...shapes({
          id: "c",
          kind: "service",
          label: "C",
          at: { col: 0, row: 10 },
          size: { cols: 3, rows: 7 },
        }),
        arrows: [],
      }),
    ).toBe(false);
  });

  test("refuses a self-arrow, a pair joined twice either way, overlapping shapes", () => {
    expect(ok({ ...shapes(), arrows: [{ from: "a", to: "a" }] })).toBe(false);
    expect(
      ok({
        ...shapes(),
        arrows: [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      }),
    ).toBe(false);
    expect(
      ok({
        ...shapes({
          id: "c",
          kind: "cache",
          label: "C",
          at: { col: 1, row: 1 },
        }),
        arrows: [],
      }),
    ).toBe(false);
    // A group holds others: it may.
    expect(
      ok({
        ...shapes({
          id: "g",
          kind: "group",
          label: "G",
          at: { col: 0, row: 0 },
          size: { cols: 9, rows: 3 },
        }),
        arrows: [],
      }),
    ).toBe(true);
  });

  test("a label fits its shape's width", () => {
    // A 2-cell client holds 10 characters.
    expect(
      ok({
        ...shapes({
          id: "c",
          kind: "client",
          label: "Ten chars!",
          at: { col: 0, row: 4 },
        }),
        arrows: [],
      }),
    ).toBe(true);
    expect(
      ok({
        ...shapes({
          id: "c",
          kind: "client",
          label: "Eleven char",
          at: { col: 0, row: 4 },
        }),
        arrows: [],
      }),
    ).toBe(false);
  });
});

group("the description", () => {
  const els = describeDiagram(raft).elements;

  test("each kind is told apart by its outline, never colour alone", () => {
    expect(find(els, "leader").some((e) => e.tag === "rect")).toBe(true);
    expect(find(els, "log").map((e) => e.tag)).toEqual(
      expect.arrayContaining(["path", "ellipse"]),
    );
    expect(find(els, "q").filter((e) => e.tag === "line").length).toBe(3);
    expect(find(els, "hot").some((e) => e.tag === "polyline")).toBe(true);
    expect(
      find(els, "cluster").find((e) => e.tag === "rect")?.attrs[
        "strokeDasharray"
      ],
    ).toBe("6 4");
    expect(find(els, "tip").some((e) => e.tag === "path")).toBe(true);
    expect(find(els, "app").filter((e) => e.tag === "line")).toHaveLength(2);
  });

  test("each shape is drawn at its origin and placed by a translate", () => {
    const leader = els.find((e) => e.key === "leader");
    expect(leader?.attrs["transform"]).toBe(
      `translate(${String(4 * CELL)} ${String(CELL)})`,
    );
    expect(
      find(els, "leader").find((e) => e.tag === "rect")?.attrs,
    ).toMatchObject({
      x: 0,
      y: 0,
      width: 3 * CELL,
      height: 2 * CELL,
    });
  });

  test("colours are token names, for each platform's theme", () => {
    const colours = new Set(
      els
        .flatMap(all)
        .flatMap((e) => [e.attrs["stroke"], e.attrs["fill"]])
        .filter((c) => c !== undefined && c !== "none"),
    );
    for (const c of colours)
      expect(["ink", "ink-muted", "well", "page", "select"]).toContain(c);
  });

  test("the view box holds every shape, and stays put as shapes are hidden", () => {
    const whole = describeDiagram(raft).viewBox;
    expect(whole).toEqual({
      x: -CELL / 2,
      y: -CELL / 2,
      width: 11 * CELL + CELL,
      height: 7 * CELL + CELL,
    });
    expect(
      describeDiagram(raft, { hidden: ["cluster", "tip"] }).viewBox,
    ).toEqual(whole);
    const nothing = describeDiagram(raft, {
      hidden: raft.shapes.map((s) => s.id),
    });
    expect(nothing.elements).toEqual([]);
    expect(nothing.viewBox).toEqual(whole);
  });

  test("an arrow runs edge to edge, its head pointing the way it goes, its label on top", () => {
    const write = find(els, "app->leader");
    // App (a 2x2 client at col 0) to Leader (3x2 at col 4), both on row 1.
    expect(write.find((e) => e.tag === "line")?.attrs).toMatchObject({
      x1: 2 * CELL,
      y1: 2 * CELL,
      x2: 4 * CELL,
      y2: 2 * CELL,
    });
    // The label is drawn last, above the shapes.
    expect(els.at(-1)).toMatchObject({
      key: "app->leader:label",
      text: "write",
    });
    expect(
      find(els, "leader->log").find((e) => e.tag === "line")?.attrs[
        "strokeDasharray"
      ],
    ).toBe("6 4");
    // An arrow into its group.
    expect(find(els, "app->cluster").some((e) => e.tag === "line")).toBe(true);
  });

  test("the head points left, down, or across touching shapes, as the arrow goes", () => {
    const tip = (d: object, key: string) => {
      const head = find(describeDiagram(Diagram.parse(d)).elements, key).find(
        (e) => e.tag === "path",
      );
      const n = String(head?.attrs["d"]).split(" ").map(Number);
      // M x y L x1 y1 L x2 y2: the tip, then the two back corners.
      return {
        tip: { x: n[1] ?? 0, y: n[2] ?? 0 },
        back: { x: n[4] ?? 0, y: n[5] ?? 0 },
      };
    };
    const left = tip({ ...shapes(), arrows: [{ from: "b", to: "a" }] }, "b->a");
    expect(left.back.x).toBeGreaterThan(left.tip.x);
    const down = tip(
      {
        ...shapes({
          id: "c",
          kind: "service",
          label: "C",
          at: { col: 0, row: 4 },
        }),
        arrows: [{ from: "a", to: "c" }],
      },
      "a->c",
    );
    expect(down.back.y).toBeLessThan(down.tip.y);
    // Touching boxes (a ends at col 3, t starts there), pointing left.
    const touching = tip(
      {
        title: "x",
        shapes: [
          { id: "a", kind: "service", label: "A", at: { col: 0, row: 0 } },
          { id: "t", kind: "service", label: "T", at: { col: 3, row: 0 } },
        ],
        arrows: [{ from: "t", to: "a" }],
      },
      "t->a",
    );
    expect(touching.back.x).toBeGreaterThan(touching.tip.x);
  });

  test("shapes and arrows highlight in select; hidden ones, and their arrows, are left out", () => {
    const shown = describeDiagram(raft, {
      highlight: ["leader", "app->leader"],
      hidden: ["tip", "leader->log"],
    }).elements;
    expect(
      find(shown, "leader").some((e) => e.attrs["stroke"] === "select"),
    ).toBe(true);
    expect(
      find(shown, "app->leader").every(
        (e) => e.tag === "g" || e.attrs["stroke"] === "select",
      ),
    ).toBe(true);
    expect(shown.some((e) => e.key === "tip")).toBe(false);
    expect(shown.some((e) => e.key === "leader->log")).toBe(false);
    const noLog = describeDiagram(raft, { hidden: ["log"] }).elements;
    expect(noLog.some((e) => e.key === "leader->log")).toBe(false);
  });

  test("labels are text, never markup; the title names the diagram", () => {
    const sneaky = Diagram.parse({
      title: "T",
      shapes: [
        { id: "a", kind: "service", label: "<b>x</b>", at: { col: 0, row: 0 } },
      ],
      arrows: [],
    });
    const texts = describeDiagram(sneaky)
      .elements.flatMap(all)
      .filter((e) => e.tag === "text");
    expect(texts[0]?.text).toBe("<b>x</b>");
    expect(describeDiagram(sneaky).title).toBe("T");
  });
});
