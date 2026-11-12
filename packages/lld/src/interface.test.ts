import { expect, test } from "vitest";
import { Interface } from "./interface";
import { counter } from "./fixtures.test-helpers";

// P5-W29-S01 (LLDQ-1): a problem's interface, in names every language accepts.
const ok = (i: object) => Interface.safeParse(i).success;

test("an interface parses", () => {
  expect(ok(counter)).toBe(true);
});

test("names every language can use, once each", () => {
  const method = (name: string) => ({
    ...counter,
    methods: [{ name, params: [], returns: "void" }],
  });
  // Keywords in Python, JS/TS, Java, C++ and Go, and the harness's own names.
  for (const name of ["class", "def", "func", "new", "delete", "range", "main"])
    expect(ok(method(name)), name).toBe(false);
  expect(ok(method("Allow"))).toBe(false);
  expect(ok(method("get_usage"))).toBe(false);
  expect(ok({ ...counter, class: "rateLimiter" })).toBe(false);
  for (const name of ["Main", "None", "NULL", "Integer", "JSON"])
    expect(ok({ ...counter, class: name }), name).toBe(false);
  for (const name of ["hashCode", "toString", "wait"])
    expect(ok(method(name)), name).toBe(false);
  expect(
    ok({ ...counter, methods: [...counter.methods, counter.methods[0]] }),
  ).toBe(false);
  expect(
    ok({
      ...counter,
      constructor: {
        params: [
          { name: "limit", type: "int" },
          { name: "limit", type: "int" },
        ],
      },
    }),
  ).toBe(false);
});

test("every type parses; only a method may return void", () => {
  expect(
    ok({
      ...counter,
      constructor: { params: [{ name: "limit", type: "integer" }] },
    }),
  ).toBe(false);
  expect(
    ok({
      ...counter,
      constructor: { params: [{ name: "limit", type: "void" }] },
    }),
  ).toBe(false);
  expect(
    ok({
      ...counter,
      methods: [{ name: "reset", params: [], returns: "list<void>" }],
    }),
  ).toBe(false);
});
