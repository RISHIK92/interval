// A small interface the tests share (P5-W29-S01).
export const counter = {
  class: "RateLimiter",
  constructor: { params: [{ name: "limit", type: "int" }] },
  methods: [
    {
      name: "allow",
      params: [
        { name: "user", type: "string" },
        { name: "at", type: "int" },
      ],
      returns: "bool",
    },
    { name: "reset", params: [], returns: "void" },
    {
      name: "usage",
      params: [{ name: "users", type: "list<string>" }],
      returns: "map<string,int>",
    },
  ],
};
