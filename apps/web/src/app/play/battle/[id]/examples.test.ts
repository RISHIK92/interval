import { expect, test } from "vitest";
import type { LoadedProblem } from "../../../../server/ports";
import { examplesOf } from "./examples";

const api: LoadedProblem["interface"] = {
  class: "LRUCache",
  constructor: { params: [{ name: "capacity", type: "int" }] },
  methods: [
    {
      name: "put",
      params: [
        { name: "key", type: "string" },
        { name: "value", type: "int" },
      ],
      returns: "void",
    },
    { name: "get", params: [{ name: "key", type: "string" }], returns: "int" },
  ],
};

// A visible test reads as the calls it makes, as code: the constructor by its class,
// arguments as JSON, and the expected value after each call that returns one.
test("calls read as code, with each returned value after its call", () => {
  expect(
    examplesOf({
      interface: api,
      visible: [
        {
          scenario: {
            calls: [
              { method: "new", args: [2] },
              { method: "put", args: ["a", 1] },
              { method: "get", args: ["a"] },
            ],
          },
          results: [
            { call: 1, value: null },
            { call: 2, value: 1 },
          ],
        },
      ],
    }),
  ).toEqual(['LRUCache(2)\nput("a", 1)\nget("a") → 1']);
});

test("a void method shows no value", () => {
  const [example] = examplesOf({
    interface: api,
    visible: [
      {
        scenario: { calls: [{ method: "put", args: ["k", 3] }] },
        results: [{ call: 0, value: null }],
      },
    ],
  });
  expect(example).toBe('put("k", 3)');
});

test("a call expected to fail says so, void or not", () => {
  expect(
    examplesOf({
      interface: api,
      visible: [
        {
          scenario: {
            calls: [
              { method: "new", args: [0] },
              { method: "put", args: ["k", -1] },
              { method: "get", args: [""] },
            ],
          },
          results: [
            { call: 0, error: "capacity" },
            { call: 1, error: "value" },
            { call: 2, error: "key" },
          ],
        },
      ],
    }),
  ).toEqual(['LRUCache(0) → fails\nput("k", -1) → fails\nget("") → fails']);
});

test("arguments and values are JSON: strings quoted, lists and objects as written", () => {
  const [example] = examplesOf({
    interface: {
      ...api,
      methods: [
        {
          name: "load",
          params: [
            { name: "keys", type: "string[]" },
            { name: "note", type: "string" },
          ],
          returns: "string[]",
        },
      ],
    },
    visible: [
      {
        scenario: {
          calls: [{ method: "load", args: [["a", "b"], 'say "hi"'] }],
        },
        results: [{ call: 0, value: ["a"] }],
      },
    ],
  });
  expect(example).toBe('load(["a","b"], "say \\"hi\\"") → ["a"]');
});
