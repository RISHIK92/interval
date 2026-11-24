import { describe, expect, test } from "vitest";
import {
  CLIPS,
  DIRECT,
  FRAGILE,
  LAVISH,
  QUEUED,
  SHORTENER,
  SIGN_IN,
  SOUND,
  STUDIO,
} from "./fixtures.test-helpers";
import { componentNames } from "./catalog";
import { addComponent, updateNode } from "./edit";
import { hints } from "./hints";
import { HldProblem } from "./problem";
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

  // Spec 2.0: a provider can't be scaled, and late work is its own hint.
  test("a provider's outage that fails requests says to queue them", () => {
    expect(hints(SIGN_IN, simulate(SIGN_IN, DIRECT))).toContain(
      'In "The SMS provider is down for 10 minutes", the external provider is down and requests that call it fail: hand that work to a queue, so it waits instead.',
    );
    // Queued, the outage is waited out: nothing to say.
    expect(hints(SIGN_IN, simulate(SIGN_IN, QUEUED))).toEqual([]);
  });

  test("a provider at its rate limit is never told to add capacity", () => {
    const busy = HldProblem.parse({
      ...SIGN_IN,
      traffic: { ...SIGN_IN.traffic, providerRps: 200 },
    });
    expect(hints(busy, simulate(busy, DIRECT))).toContain(
      'The external provider hits its rate limit in "A spike": it can\'t be scaled, so queue its calls or make fewer.',
    );
  });

  test("work that never catches up is late too", () => {
    const starved = updateNode(STUDIO, "transcoders", {
      config: { nodes: 20 },
    });
    expect(hints(CLIPS, simulate(CLIPS, starved))).toContain(
      'In "A normal day", upload work isn\'t done in time: its backlog needs consumers with room to drain it, and a queue that keeps it long enough.',
    );
  });

  test("work done past its target says what the backlog needs", () => {
    expect(hints(CLIPS, simulate(CLIPS, STUDIO))).toContain(
      'In "Two hours of three times the uploads", upload work isn\'t done in time: its backlog needs consumers with room to drain it, and a queue that keeps it long enough.',
    );
  });
});
