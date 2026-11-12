// P5-W29-S02: an interface covering every type form, with one reference solution per
// language (beside this file), and a scenario whose results all six must agree on.
export const inventory = {
  class: "Inventory",
  constructor: { params: [{ name: "capacity", type: "int" }] },
  methods: [
    {
      name: "add",
      params: [
        { name: "item", type: "string" },
        { name: "amount", type: "int" },
      ],
      returns: "int",
    },
    {
      name: "take",
      params: [
        { name: "item", type: "string" },
        { name: "amount", type: "int" },
      ],
      returns: "bool",
    },
    {
      name: "stock",
      params: [{ name: "item", type: "string" }],
      returns: "optional<int>",
    },
    { name: "items", params: [], returns: "list<string>" },
    { name: "snapshot", params: [], returns: "map<string,int>" },
    {
      name: "share",
      params: [{ name: "item", type: "string" }],
      returns: "float",
    },
    {
      name: "group",
      params: [
        { name: "names", type: "list<string>" },
        { name: "label", type: "optional<string>" },
      ],
      returns: "map<string,list<string>>",
    },
    {
      name: "flags",
      params: [{ name: "values", type: "list<optional<bool>>" }],
      returns: "list<bool>",
    },
    // An empty result the idiomatic way (Go's nil slice), and a throw of an unusual kind.
    { name: "none", params: [], returns: "list<map<string,int>>" },
    { name: "odd", params: [], returns: "int" },
    { name: "clear", params: [], returns: "void" },
  ],
};

export const scenario = {
  calls: [
    { method: "new", args: [10] },
    { method: "add", args: ["apple", 3] },
    { method: "add", args: ["pear", 2] },
    { method: "stock", args: ["apple"] },
    { method: "stock", args: ["kiwi"] },
    { method: "items", args: [] },
    { method: "snapshot", args: [] },
    { method: "share", args: ["apple"] },
    { method: "group", args: [["a", "b"], null] },
    { method: "group", args: [["c"], "x"] },
    { method: "flags", args: [[true, null, false]] },
    // Over capacity: every solution raises, so this line is an error everywhere.
    { method: "add", args: ["fig", 100] },
    { method: "take", args: ["pear", 1] },
    { method: "take", args: ["kiwi", 1] },
    { method: "none", args: [] },
    { method: "odd", args: [] },
    { method: "clear", args: [] },
    { method: "items", args: [] },
  ],
};

// What every language must print, the errors only as "an error".
export const expected = [
  { call: 0, value: null },
  { call: 1, value: 3 },
  { call: 2, value: 2 },
  { call: 3, value: 3 },
  { call: 4, value: null },
  { call: 5, value: ["apple", "pear"] },
  { call: 6, value: { apple: 3, pear: 2 } },
  { call: 7, value: 0.3 },
  { call: 8, value: { none: ["a", "b"] } },
  { call: 9, value: { x: ["c"] } },
  { call: 10, value: [true, false, false] },
  { call: 11, error: true },
  { call: 12, value: true },
  { call: 13, value: false },
  { call: 14, value: [] },
  { call: 15, error: true },
  { call: 16, value: null },
  { call: 17, value: [] },
];

// A constructor that fails: its line and every later one are errors, never a crash.
export const broken = {
  calls: [
    { method: "new", args: [-1] },
    { method: "items", args: [] },
  ],
};
