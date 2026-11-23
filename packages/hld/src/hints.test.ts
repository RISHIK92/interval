import { describe, expect, test } from "vitest";
import { FRAGILE, LAVISH, SHORTENER, SOUND } from "./fixtures.test-helpers";
import { componentNames } from "./catalog";
import { addComponent } from "./edit";
import { hints } from "./hints";
import { simulate } from "./simulate";

// P6-W39 (Q-P6-03): hints by rule from the preview simulation.
const of = (design: typeof SOUND) =>
  hints(SHORTENER, simulate(SHORTENER, design));

describe("hints", () => {
  test("a sound design gets none", () => {
    expect(of(SOUND)).toEqual([]);
  });

  test("an overloaded, single-zone design hears about both, the worst first", () => {
    const h = of(FRAGILE);
    expect(h[0]).toBe(
      'The app service can\'t keep up in "A normal day": give it more capacity.',
    );
    expect(h).toContain(
      'In "A zone goes down", the load balancer, app service and SQL database go down with nothing to take over: spread them over more zones or add failover.',
    );
    expect(h.length).toBeLessThanOrEqual(5);
  });

  test("a design that serves nothing is told where requests stop", () => {
    const h = of({ ...SOUND, nodes: SOUND.nodes.slice(0, 1), edges: [] });
    expect(h).toEqual([
      "Read requests aren't reaching anything that can answer them: connect them through an app service to a cache or database.",
      "Write requests aren't reaching anything that keeps them: connect them through an app service to a database.",
      "Nothing keeps the writes yet: connect the app service to a database or store.",
    ]);
  });

  test("a big outage is grouped by kind and capped, in one short line", () => {
    const big = (
      ["app_service", "cache", "cache", "kv_store", "kv_store"] as const
    ).reduce((d, kind) => addComponent(d, kind, { x: 0, y: 0 }), FRAGILE);
    const h = of(big);
    const outage = h.find((x) => x.startsWith('In "A zone goes down"'));
    expect(outage).toMatch(
      /^In "A zone goes down", the load balancer, 2 app services, SQL database and 4 more go down/,
    );
  });

  test("going over budget is a hint", () => {
    expect(of(LAVISH)).toContain(
      "The design costs more than the budget: trim capacity it doesn't use.",
    );
  });

  test("components are named as a player reads them, numbered when repeated", () => {
    const names = componentNames([
      { id: "users", kind: "client" },
      { id: "app-service", kind: "app_service" },
      { id: "app-service-2", kind: "app_service" },
      { id: "db", kind: "sql_db" },
    ]);
    expect([...names.values()]).toEqual([
      "Client",
      "App service 1",
      "App service 2",
      "SQL database",
    ]);
  });
});
