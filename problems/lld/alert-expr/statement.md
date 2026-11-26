# Alert expressions

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An alerting service lets teams write conditions such as
`cpu > 90 and not (region == 3 or mem.free < 512)`. Each condition is parsed once, when
it is created, and then evaluated against every new snapshot of the metrics.

**The language.** Tokens may be separated by any number of spaces, and need not be:

- a metric name: a letter (`A`–`Z` or `a`–`z`), then any letters, digits, `_` and `.`.
  The words `and`, `or` and `not` (in lower case) are keywords, never metric names.
- an integer: an optional `-` directly followed by 1 to 15 digits (leading zeros are
  allowed).
- a comparison operator: `>`, `>=`, `<`, `<=`, `==` or `!=`; or `(` or `)`.

The grammar, from the loosest binding to the tightest:

```text
expression := conjunction ("or" conjunction)*
conjunction := negation ("and" negation)*
negation := "not" negation | "(" expression ")" | NAME OPERATOR INTEGER
```

`and` and `or` group from the left: `a > 1 and b > 1 and c > 1` is
`(a > 1 and b > 1) and c > 1`. Anything else, including an empty expression, a character
outside the tokens and a token left over at the end, is bad syntax.

- `AlertExpr(expression)`: parses the expression. Bad syntax fails.
- `evaluate(metrics)`: the expression's value for these metric values. A comparison on a
  metric that isn't in `metrics` is false. `and` and `or` evaluate from the left and stop
  as soon as the result is known: `and` skips its right side when its left is false, and
  `or` when its left is true.
- `variables()`: the metric names used in the expression, each once, sorted.
- `depth()`: the depth of the parsed tree. A comparison has depth 1, `not x` has depth
  `1 + depth(x)`, and `x and y` and `x or y` have `1 + max(depth(x), depth(y))`.
  Parentheses add nothing.
- `evaluations()`: how many comparisons have been evaluated so far, over every
  `evaluate` call. A comparison skipped by `and` or `or` isn't counted, and one on an
  absent metric is.

Names are case-sensitive, and sorted means by character code. Metric values are between
`-10^15` and `10^15`. An expression has at most 1,000 characters, brackets and `not`
nest at most 100 deep, and there are at most 10^4 calls.

For example, `AlertExpr("cpu > 90 and not (region == 3 or mem.free < 512)")` has depth 4
and variables `["cpu", "mem.free", "region"]`. `evaluate({"cpu": 50})` returns `false`
after evaluating one comparison, and `evaluate({"cpu": 95, "region": 3})` returns `false`
after evaluating two.
